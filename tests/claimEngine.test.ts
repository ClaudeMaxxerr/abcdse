/**
 * claimEngine.test.ts — Phase B3
 *
 * All required unit tests for the claim engine.
 * Uses mock DB objects — no real Postgres connection required.
 *
 * Tests:
 *  1.  Technical dept member claiming Easy → rejected
 *  2.  General member claiming a 4th Easy → rejected
 *  3.  Member with 2 active claims → rejected; after PR raised on one → succeeds
 *  4.  Two members of SAME team on Medium → second rejected
 *  5.  Two members of DIFFERENT teams on Medium → both accepted
 *  6.  3rd claimer on full Medium → waitlisted at position 1
 *  7.  Expiry frees spot and promotes waitlist head with new 48h deadline
 *  8.  Member whose claim expired cannot re-claim
 *  9.  Edited comment never creates a claim
 * 10.  "Claiming this issue please!" (longer sentence) is not a claim
 * 11.  Bot comment never triggers the engine
 * 12.  10-way concurrent race resolves to exactly one winner (mock — real race in concurrency.test.ts)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseClaimIntent,
  processClaimComment,
  processUnclaimComment,
  CommentContext,
  IssueContext,
} from "../src/domain/claimEngine.js";
import { ClaimStatus, IssueLevel, Tier, Team, Department } from "@prisma/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeComment(overrides: Partial<CommentContext> = {}): CommentContext {
  return {
    commentId: BigInt(1001),
    githubUserId: BigInt(42),
    body: "Claiming this issue",
    createdAt: "2026-09-19T06:00:00Z",
    updatedAt: "2026-09-19T06:00:00Z",
    ...overrides,
  };
}

const ISSUE_CTX: IssueContext = {
  repoOwner: "AARVAK-VSET",
  repoName: "aqua-sense",
  issueNumber: 7,
};

function makeMember(overrides: Partial<{
  id: string;
  githubUserId: bigint;
  githubLogin: string;
  tier: Tier;
  team: Team;
  department: Department;
}> = {}) {
  return {
    id: overrides.id ?? "member-1",
    githubUserId: overrides.githubUserId ?? BigInt(42),
    githubLogin: overrides.githubLogin ?? "alice",
    displayName: "Alice",
    department: overrides.department ?? Department.pr,
    team: overrides.team ?? Team.NEXUS,
    tier: overrides.tier ?? Tier.general,
    isAdmin: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Mock DB builder — mimics Prisma's $transaction(async tx => ...) shape
// ---------------------------------------------------------------------------

type MockQueryRawResult = { id: string; spots: number; level: IssueLevel }[];

interface MockDBOpts {
  issue?: { id: string; spots: number; level: IssueLevel } | null;
  member?: ReturnType<typeof makeMember> | null;
  activeClaims?: number;
  easyClaimsCount?: number;
  hardClaimsCount?: number;
  committedClaimsCount?: number;
  pullRequests?: Array<{
    id?: string;
    number?: number;
    countsForScore?: boolean;
    openedAt?: Date | string;
    issue?: { level: IssueLevel };
  }>;
  expiredClaimOnIssue?: boolean;
  occupiedClaims?: Array<{ id: string; memberId: string; member: { team: Team; id: string } }>;
  waitlistCount?: number;
  existingWaitlistEntry?: { id: string; position: number } | null;
}

function buildMockDb(opts: MockDBOpts = {}) {
  const {
    issue = { id: "issue-easy-1", spots: 1, level: IssueLevel.easy },
    member = makeMember(),
    activeClaims = 0,
    easyClaimsCount = 0,
    hardClaimsCount = 0,
    committedClaimsCount,
    pullRequests = [],
    expiredClaimOnIssue = false,
    occupiedClaims = [],
    waitlistCount = 0,
    existingWaitlistEntry = null,
  } = opts;

  const createdClaims: unknown[] = [];
  const postedComments: Array<{ issueId: string; kind: string; body: string; memberId: string | null }> = [];

  const txClient = {
    $queryRaw: vi.fn().mockResolvedValue(issue ? [issue] : ([] as MockQueryRawResult)),
    member: {
      findUnique: vi.fn().mockResolvedValue(member),
    },
    pullRequest: {
      findMany: vi.fn().mockResolvedValue(pullRequests),
    },
    claim: {
      count: vi.fn().mockImplementation(async ({ where }: { where?: { status?: unknown; issue?: { level?: IssueLevel } } }) => {
        // Distinguish active claims count from easy/hard claims count by checking 'issue' key
        if (where && "issue" in where) {
          if (where.issue?.level === IssueLevel.hard) return hardClaimsCount;
          return easyClaimsCount;
        }
        const statusIn = (where?.status as { in?: ClaimStatus[] })?.in;
        if (statusIn && (statusIn.includes(ClaimStatus.pr_raised) || statusIn.includes(ClaimStatus.merged))) {
          return committedClaimsCount !== undefined ? committedClaimsCount : pullRequests.length + activeClaims;
        }
        return activeClaims;
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: { where: { status?: unknown } }) => {
        // Handle both scalar status (status: ClaimStatus.expired) and array form (status: { in: [...] })
        const scalarStatus = where?.status as ClaimStatus | undefined;
        const statusArr = (where?.status as { in?: ClaimStatus[] })?.in;
        const isExpiredLookup =
          scalarStatus === ClaimStatus.expired ||
          statusArr?.includes(ClaimStatus.expired);
        if (isExpiredLookup) {
          return expiredClaimOnIssue ? { id: "expired-claim", deadline: new Date("2026-09-17T00:00:00Z") } : null;
        }
        // Active-claim lookup for unclaim (status: { in: [active] })
        return null;
      }),
      findMany: vi.fn().mockResolvedValue(occupiedClaims),
      create: vi.fn().mockImplementation(async (args: { data: unknown }) => {
        const created = { id: `claim-${createdClaims.length + 1}`, ...args.data };
        createdClaims.push(created);
        return created;
      }),
    },
    waitlistEntry: {
      findFirst: vi.fn().mockResolvedValue(existingWaitlistEntry),
      count: vi.fn().mockResolvedValue(waitlistCount),
      create: vi.fn().mockResolvedValue({ id: "wl-1", position: waitlistCount + 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
  };

  const db = {
    $transaction: vi.fn().mockImplementation(async (cb: (tx: typeof txClient) => Promise<unknown>) => {
      return cb(txClient);
    }),
    issue: {
      findFirst: vi.fn().mockResolvedValue(issue ? { id: issue.id } : null),
    },
    botComment: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: { data: { issueId: string; kind: string; memberId: string | null } }) => {
        return { id: `bc-${Date.now()}`, commentId: BigInt(Date.now()), ...data };
      }),
    },
  };

  const postReply = vi.fn().mockImplementation(
    async (issueId: string, kind: string, body: string, memberId: string | null) => {
      postedComments.push({ issueId, kind, body, memberId });
    }
  );

  return { db: db as unknown as Parameters<typeof processClaimComment>[0], txClient, postedComments, postReply, createdClaims };
}

// ---------------------------------------------------------------------------
// Section 1: parseClaimIntent
// ---------------------------------------------------------------------------

describe("parseClaimIntent — exact matching", () => {
  it("accepts exact 'Claiming this issue'", () => {
    expect(parseClaimIntent("Claiming this issue")).toBe("claim");
  });

  it("accepts case variations", () => {
    expect(parseClaimIntent("claiming this issue")).toBe("claim");
    expect(parseClaimIntent("CLAIMING THIS ISSUE")).toBe("claim");
    expect(parseClaimIntent("Claiming This Issue")).toBe("claim");
  });

  it("accepts with trailing punctuation stripped", () => {
    expect(parseClaimIntent("Claiming this issue.")).toBe("claim");
    expect(parseClaimIntent("Claiming this issue!")).toBe("claim");
    expect(parseClaimIntent("Claiming this issue?")).toBe("claim");
    expect(parseClaimIntent("Claiming this issue,")).toBe("claim");
  });

  it("accepts with surrounding whitespace", () => {
    expect(parseClaimIntent("  Claiming this issue  ")).toBe("claim");
    expect(parseClaimIntent("\tClaiming this issue\n")).toBe("claim");
  });

  it("rejects a body CONTAINING the phrase inside a sentence", () => {
    expect(parseClaimIntent("I am claiming this issue please")).toBeNull();
    expect(parseClaimIntent("Claiming this issue please!")).toBeNull();
    expect(parseClaimIntent("Hi, I am claiming this issue for team NEXUS")).toBeNull();
  });

  it("accepts exact 'Unclaiming this issue'", () => {
    expect(parseClaimIntent("Unclaiming this issue")).toBe("unclaim");
    expect(parseClaimIntent("unclaiming this issue.")).toBe("unclaim");
  });

  it("returns null for unrelated comment bodies", () => {
    expect(parseClaimIntent("Great issue!")).toBeNull();
    expect(parseClaimIntent("")).toBeNull();
    expect(parseClaimIntent("lgtm")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 9: Edited comment never creates a claim
// ---------------------------------------------------------------------------

describe("Test 9: edited comment never creates a claim", () => {
  it("rejects a comment where created_at !== updated_at", async () => {
    const { db, postedComments, postReply } = buildMockDb();
    const comment = makeComment({
      body: "Claiming this issue",
      createdAt: "2026-09-19T06:00:00Z",
      updatedAt: "2026-09-19T06:05:00Z", // DIFFERENT — edited!
    });

    const result = await processClaimComment(db, comment, ISSUE_CTX, { postReply });
    expect(result.outcome).toBe("edited_rejected");
    expect(postedComments.some((c) => c.kind === "claim_edited_rejected")).toBe(true);
    expect(postedComments[0]!.body).toContain("edited");
  });
});

// ---------------------------------------------------------------------------
// Test 11: Bot comment never triggers the engine
// ---------------------------------------------------------------------------

describe("Test 11: bot self-comment is silently ignored", () => {
  it("returns bot_self_comment when commenter is the bot", async () => {
    const { db, postReply } = buildMockDb();
    const botUserId = BigInt(99999);
    const comment = makeComment({ githubUserId: botUserId, body: "Claiming this issue" });

    const result = await processClaimComment(db, comment, ISSUE_CTX, { botUserId, postReply });
    expect(result.outcome).toBe("bot_self_comment");
    expect(postReply).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 10: "Claiming this issue please!" is not a claim
// ---------------------------------------------------------------------------

describe("Test 10: body containing phrase inside longer sentence is not a claim", () => {
  it("returns not_a_claim for 'Claiming this issue please!'", async () => {
    const { db, postReply } = buildMockDb();
    const comment = makeComment({ body: "Claiming this issue please!" });

    const result = await processClaimComment(db, comment, ISSUE_CTX, { postReply });
    expect(result.outcome).toBe("not_a_claim");
    // A hint comment is posted (format_hint) but no claim created
    expect(postReply).toHaveBeenCalledWith(
      expect.any(String),
      "claim_format_hint",
      expect.stringContaining("exactly"),
      null
    );
  });

  it("returns not_a_claim for 'I want to claim this issue'", async () => {
    const { db, postReply } = buildMockDb();
    const result = await processClaimComment(
      db,
      makeComment({ body: "I want to claim this issue" }),
      ISSUE_CTX,
      { postReply }
    );
    expect(result.outcome).toBe("not_a_claim");
  });
});

// ---------------------------------------------------------------------------
// Test 1: Technical dept member claiming Easy is rejected
// ---------------------------------------------------------------------------

describe("Test 1: tech-tier member cannot claim Easy issues", () => {
  it("rejects with tier_forbidden and posts a specific bot comment", async () => {
    const { db, postedComments, postReply } = buildMockDb({
      issue: { id: "issue-easy-1", spots: 1, level: IssueLevel.easy },
      member: makeMember({ tier: Tier.tech, department: Department.technical }),
    });

    const result = await processClaimComment(db, makeComment(), ISSUE_CTX, { postReply });
    expect(result.outcome).toBe("tier_forbidden");
    expect(result).toMatchObject({ outcome: "tier_forbidden" });
    const msg = (result as { message: string }).message;
    expect(msg).toContain("Technical department members may not claim Easy");
    expect(postedComments.some((c) => c.kind === "claim_tier_forbidden")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 2: General member claiming a 4th Easy is rejected
// ---------------------------------------------------------------------------

describe("Test 2: general member 4th Easy claim is rejected", () => {
  it("rejects with easy_limit when member already has 3 Easy claims", async () => {
    const { db, postedComments, postReply } = buildMockDb({
      issue: { id: "issue-easy-5", spots: 1, level: IssueLevel.easy },
      member: makeMember({ tier: Tier.general }),
      easyClaimsCount: 3, // already at limit
    });

    const result = await processClaimComment(db, makeComment(), ISSUE_CTX, { postReply });
    expect(result.outcome).toBe("easy_limit");
    const msg = (result as { message: string }).message;
    expect(msg).toContain("Easy issue limit reached");
    expect(postedComments.some((c) => c.kind === "claim_easy_limit")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Member with 2 active claims is rejected; after PR raised, succeeds
// ---------------------------------------------------------------------------

describe("Test 3: 2-active-claims limit", () => {
  it("rejects when member already holds 2 active claims (shows 2/2 and rejected on third)", async () => {
    const { db, postedComments, postReply } = buildMockDb({
      issue: { id: "issue-m-1", spots: 2, level: IssueLevel.medium },
      member: makeMember({ tier: Tier.general }),
      activeClaims: 2, // at limit (2 active claims)
    });

    const result = await processClaimComment(db, makeComment(), ISSUE_CTX, { postReply });
    expect(result.outcome).toBe("active_claims_limit");
    const msg = (result as { message: string }).message;
    expect(msg).toContain("Active claim limit reached");
    expect(postedComments.some((c) => c.kind === "claim_active_limit")).toBe(true);
  });

  it("succeeds when member has 1 active + 1 pr_raised claim (freed slot lets them claim a third issue)", async () => {
    // When a PR is raised, status changes to pr_raised — only 1 active claim remains
    const { db, postReply } = buildMockDb({
      issue: { id: "issue-m-2", spots: 2, level: IssueLevel.medium },
      member: makeMember({ tier: Tier.general }),
      activeClaims: 1, // 1 active + 1 pr_raised -> activeClaimsCount is 1
      occupiedClaims: [], // no occupied spots yet on this issue
    });

    const result = await processClaimComment(db, makeComment(), ISSUE_CTX, { postReply });
    expect(result.outcome).toBe("accepted");
    expect((result as { deadline: Date }).deadline).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Two members of SAME team on Medium → second is rejected
// ---------------------------------------------------------------------------

describe("Test 4: same-team restriction on Medium issue", () => {
  it("rejects the second claimer from the same team", async () => {
    const { db, postedComments, postReply } = buildMockDb({
      issue: { id: "issue-med-1", spots: 2, level: IssueLevel.medium },
      member: makeMember({ id: "member-2", githubUserId: BigInt(43), team: Team.NEXUS }),
      occupiedClaims: [
        {
          id: "claim-1",
          memberId: "member-1",
          member: { id: "member-1", team: Team.NEXUS }, // SAME team!
        },
      ],
    });

    const comment = makeComment({ githubUserId: BigInt(43), commentId: BigInt(1002) });
    const result = await processClaimComment(db, comment, ISSUE_CTX, { postReply });
    expect(result.outcome).toBe("same_team");
    const msg = (result as { message: string }).message;
    expect(msg).toContain("Same-team restriction");
    expect(postedComments.some((c) => c.kind === "claim_same_team")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 5: Two members of DIFFERENT teams on Medium → both accepted
// ---------------------------------------------------------------------------

describe("Test 5: different-team members both accepted on Medium", () => {
  it("accepts second claimer from different team", async () => {
    const { db, postReply } = buildMockDb({
      issue: { id: "issue-med-2", spots: 2, level: IssueLevel.medium },
      member: makeMember({ id: "member-2", githubUserId: BigInt(44), team: Team.CIPHER }),
      occupiedClaims: [
        {
          id: "claim-1",
          memberId: "member-1",
          member: { id: "member-1", team: Team.NEXUS }, // DIFFERENT team
        },
      ],
    });

    const comment = makeComment({ githubUserId: BigInt(44), commentId: BigInt(1003) });
    const result = await processClaimComment(db, comment, ISSUE_CTX, { postReply });
    expect(result.outcome).toBe("accepted");
  });

  it("accepts first claimer on Medium (no occupied spots)", async () => {
    const { db, postReply } = buildMockDb({
      issue: { id: "issue-med-3", spots: 2, level: IssueLevel.medium },
      member: makeMember({ team: Team.NEXUS }),
      occupiedClaims: [],
    });

    const result = await processClaimComment(db, makeComment(), ISSUE_CTX, { postReply });
    expect(result.outcome).toBe("accepted");
  });
});

// ---------------------------------------------------------------------------
// Test 6: 3rd claimer on full Medium goes to waitlist at position 1
// ---------------------------------------------------------------------------

describe("Test 6: waitlisting on full issue", () => {
  it("adds 3rd claimer to waitlist at position 1", async () => {
    const { db, postedComments, postReply } = buildMockDb({
      issue: { id: "issue-med-4", spots: 2, level: IssueLevel.medium },
      member: makeMember({ id: "member-3", githubUserId: BigInt(45), team: Team.BYTE_BRIGADE }),
      occupiedClaims: [
        { id: "c1", memberId: "m1", member: { id: "m1", team: Team.NEXUS } },
        { id: "c2", memberId: "m2", member: { id: "m2", team: Team.CIPHER } },
      ], // Full! 2 spots occupied
      waitlistCount: 0, // no existing waitlist entries
      existingWaitlistEntry: null,
    });

    const comment = makeComment({ githubUserId: BigInt(45), commentId: BigInt(1004) });
    const result = await processClaimComment(db, comment, ISSUE_CTX, { postReply });
    expect(result.outcome).toBe("waitlisted");
    expect((result as { position: number }).position).toBe(1);
    const msg = (result as { message: string }).message;
    expect(msg).toContain("position **1**");
    expect(postedComments.some((c) => c.kind === "claim_waitlisted")).toBe(true);
    expect(postedComments[0]!.body).toContain("position **1**");
  });

  it("adds 2nd waitlister at position 2", async () => {
    const { db, postReply } = buildMockDb({
      issue: { id: "issue-med-5", spots: 2, level: IssueLevel.medium },
      member: makeMember({ id: "member-4", githubUserId: BigInt(46), team: Team.ASCEND }),
      occupiedClaims: [
        { id: "c1", memberId: "m1", member: { id: "m1", team: Team.NEXUS } },
        { id: "c2", memberId: "m2", member: { id: "m2", team: Team.CIPHER } },
      ],
      waitlistCount: 1, // one entry already on waitlist
      existingWaitlistEntry: null,
    });

    const result = await processClaimComment(
      db,
      makeComment({ githubUserId: BigInt(46), commentId: BigInt(1005) }),
      ISSUE_CTX,
      { postReply }
    );
    expect(result.outcome).toBe("waitlisted");
    expect((result as { position: number }).position).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Test 8: Member whose claim expired cannot re-claim
// ---------------------------------------------------------------------------

describe("Test 8: previously-expired member cannot re-claim", () => {
  it("rejects re-claim attempt with previously_expired", async () => {
    const { db, postedComments, postReply } = buildMockDb({
      issue: { id: "issue-easy-3", spots: 1, level: IssueLevel.easy },
      member: makeMember({ tier: Tier.general }),
      expiredClaimOnIssue: true, // had a previous expired claim on this issue
      occupiedClaims: [], // spot is free but member can't re-claim
    });

    const result = await processClaimComment(db, makeComment(), ISSUE_CTX, { postReply });
    expect(result.outcome).toBe("previously_expired");
    const msg = (result as { message: string }).message;
    expect(msg).toContain("cannot re-claim");
    expect(postedComments.some((c) => c.kind === "claim_previously_expired")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 7: Expiry frees spot and promotes waitlist head (unit test of promoteWaitlistHead)
// ---------------------------------------------------------------------------

import { promoteWaitlistHead } from "../src/domain/claimEngine.js";

describe("Test 7: promoteWaitlistHead", () => {
  it("promotes the first unresolved waitlist entry and sets 48h deadline", async () => {
    const now = new Date("2026-09-19T10:00:00Z");
    const expectedDeadline = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    const waitlistHead = {
      id: "wl-head",
      memberId: "member-waiting",
      issueId: "issue-1",
      commentId: BigInt(9001),
      position: 1,
      queuedAt: new Date("2026-09-18T08:00:00Z"),
      resolvedAt: null,
      member: { id: "member-waiting", githubLogin: "bob" },
    };

    const updatedEntries: string[] = [];
    const createdClaims: unknown[] = [];

    const tx = {
      waitlistEntry: {
        findFirst: vi.fn().mockResolvedValue(waitlistHead),
        update: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
          updatedEntries.push(where.id);
          return { ...waitlistHead, resolvedAt: now };
        }),
      },
      claim: {
        upsert: vi.fn().mockImplementation(async ({ create }: { create: unknown }) => {
          createdClaims.push(create);
          return { id: "new-claim", ...create };
        }),
      },
    } as unknown as Parameters<typeof promoteWaitlistHead>[1];

    vi.setSystemTime(now);
    const result = await promoteWaitlistHead("issue-1", tx);
    vi.useRealTimers();

    expect(result.promoted).toBe(true);
    expect(result.memberId).toBe("member-waiting");
    expect(result.deadline).toBeInstanceOf(Date);
    // Deadline should be ~48h from now
    expect(result.deadline!.getTime()).toBeGreaterThanOrEqual(expectedDeadline.getTime() - 1000);
    expect(result.deadline!.getTime()).toBeLessThanOrEqual(expectedDeadline.getTime() + 1000);
    expect(updatedEntries).toContain("wl-head");
    expect(createdClaims).toHaveLength(1);
  });

  it("returns promoted=false when no waitlist entries exist", async () => {
    const tx = {
      waitlistEntry: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as Parameters<typeof promoteWaitlistHead>[1];

    const result = await promoteWaitlistHead("issue-empty", tx);
    expect(result.promoted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 12: 10-way sequential mock race (parallelism proven in concurrency.test.ts)
// ---------------------------------------------------------------------------

describe("Test 12 (mock): 10 sequential claims on 1-spot Easy — exactly 1 accepted", () => {
  it("accepts only the first claim and rejects/waitlists the rest", async () => {
    const outcomes: string[] = [];

    // Simulate occupiedClaims growing after each acceptance
    let occupiedCount = 0;
    const issueId = "issue-easy-race";

    for (let i = 0; i < 10; i++) {
      const { db, postReply } = buildMockDb({
        issue: { id: issueId, spots: 1, level: IssueLevel.easy },
        member: makeMember({
          id: `member-${i}`,
          githubUserId: BigInt(100 + i),
          githubLogin: `user${i}`,
          tier: Tier.general,
        }),
        occupiedClaims:
          occupiedCount > 0
            ? [{ id: "c-0", memberId: "member-0", member: { id: "member-0", team: Team.NEXUS } }]
            : [],
        waitlistCount: Math.max(0, occupiedCount - 1),
        existingWaitlistEntry: null,
      });

      const comment = makeComment({
        commentId: BigInt(2000 + i),
        githubUserId: BigInt(100 + i),
        // Strictly ordered created_at
        createdAt: `2026-09-19T06:${String(i).padStart(2, "0")}:00Z`,
        updatedAt: `2026-09-19T06:${String(i).padStart(2, "0")}:00Z`,
      });

      const result = await processClaimComment(db, comment, ISSUE_CTX, { postReply });
      outcomes.push(result.outcome);

      if (result.outcome === "accepted") occupiedCount++;
    }

    const accepted = outcomes.filter((o) => o === "accepted");
    const waitlisted = outcomes.filter((o) => o === "waitlisted");

    expect(accepted).toHaveLength(1);
    expect(waitlisted).toHaveLength(9);
    // Winner is the first one (index 0 = earliest created_at)
    expect(outcomes[0]).toBe("accepted");
  });
});

// ---------------------------------------------------------------------------
// Unclaim tests
// ---------------------------------------------------------------------------

describe("Unclaim: processUnclaimComment", () => {
  it("returns not_an_unclaim for unrelated body", async () => {
    const { db, postReply } = buildMockDb();
    const result = await processUnclaimComment(
      db,
      makeComment({ body: "looks good" }),
      ISSUE_CTX,
      { postReply }
    );
    expect(result.outcome).toBe("not_an_unclaim");
  });

  it("returns bot_self_comment when bot unclaims", async () => {
    const { db, postReply } = buildMockDb();
    const botId = BigInt(777);
    const result = await processUnclaimComment(
      db,
      makeComment({ body: "Unclaiming this issue", githubUserId: botId }),
      ISSUE_CTX,
      { botUserId: botId, postReply }
    );
    expect(result.outcome).toBe("bot_self_comment");
  });
});

// ---------------------------------------------------------------------------
// No duplicate bot comments
// ---------------------------------------------------------------------------

describe("Bot comment de-duplication", () => {
  it("postBotComment refuses duplicate kind on same issue+member", async () => {
    const { postBotComment } = await import("../src/github/comments.js");

    const recorded: unknown[] = [];
    const mockDb = {
      botComment: {
        findFirst: vi.fn().mockImplementation(async ({ where }: { where: { issueId: string; kind: string; memberId: string } }) => {
          return recorded.find(
            (r: unknown) =>
              (r as { issueId: string; kind: string; memberId: string }).issueId === where.issueId &&
              (r as { issueId: string; kind: string; memberId: string }).kind === where.kind &&
              (r as { issueId: string; kind: string; memberId: string }).memberId === where.memberId
          );
        }),
        create: vi.fn().mockImplementation(async ({ data }: { data: unknown }) => {
          const rec = { id: `bc-${recorded.length}`, commentId: BigInt(Date.now()), ...data };
          recorded.push(rec);
          return rec;
        }),
      },
      issue: {
        findUnique: vi.fn().mockResolvedValue({
          id: "issue-1",
          number: 7,
          repo: { owner: "AARVAK-VSET", name: "aqua-sense" },
        }),
      },
    } as unknown as Parameters<typeof postBotComment>[4]["prismaClient"];

    const r1 = await postBotComment("issue-1", "claim_accepted", "msg", "member-1", { prismaClient: mockDb });
    expect(r1.posted).toBe(true);
    expect(recorded).toHaveLength(1);

    const r2 = await postBotComment("issue-1", "claim_accepted", "msg again", "member-1", { prismaClient: mockDb });
    expect(r2.posted).toBe(false);
    expect(r2.reason).toContain("already posted");
    expect(recorded).toHaveLength(1); // no duplicate
  });
});

// ---------------------------------------------------------------------------
// Mid-event rule: Tier cap potential claim-eligibility check
// ---------------------------------------------------------------------------

describe("Mid-event rule: Tier cap potential claim-eligibility check", () => {
  it("allows a tech member with 2 Hard PRs to claim (potential points 40 < 60 cap)", async () => {
    const pullRequests = [
      { id: "pr-1", number: 101, countsForScore: true, openedAt: "2026-09-19T08:00:00Z", issue: { level: IssueLevel.hard } },
      { id: "pr-2", number: 102, countsForScore: true, openedAt: "2026-09-19T10:00:00Z", issue: { level: IssueLevel.hard } },
    ];

    const { db, postReply } = buildMockDb({
      issue: { id: "issue-hard-1", spots: 2, level: IssueLevel.hard },
      member: makeMember({ id: "tech-1", tier: Tier.tech, department: Department.technical }),
      pullRequests,
      activeClaims: 0,
      committedClaimsCount: 2,
    });

    const result = await processClaimComment(db, makeComment(), ISSUE_CTX, { postReply });
    expect(result.outcome).toBe("accepted");
  });

  it("allows a tech member with 3 Hard PRs and 3 claims to claim (buffer allows up to 4 claims)", async () => {
    // 3 Hard PRs = 60 potential points (cap reached at 3 PRs).
    // Buffer allows claimsNeededToReachCap + 1 = 3 + 1 = 4 claims.
    // Holding 3 claims is below 4, so claim is accepted.
    const pullRequests = [
      { id: "pr-1", number: 101, countsForScore: true, openedAt: "2026-09-19T08:00:00Z", issue: { level: IssueLevel.hard } },
      { id: "pr-2", number: 102, countsForScore: true, openedAt: "2026-09-19T10:00:00Z", issue: { level: IssueLevel.hard } },
      { id: "pr-3", number: 103, countsForScore: true, openedAt: "2026-09-19T12:00:00Z", issue: { level: IssueLevel.hard } },
    ];

    const { db, postReply } = buildMockDb({
      issue: { id: "issue-hard-2", spots: 2, level: IssueLevel.hard },
      member: makeMember({ id: "tech-1", tier: Tier.tech, department: Department.technical }),
      pullRequests,
      activeClaims: 0,
      committedClaimsCount: 3, // 3 claims held < 4 threshold
    });

    const result = await processClaimComment(db, makeComment(), ISSUE_CTX, { postReply });
    expect(result.outcome).toBe("accepted");
  });

  it("rejects a tech member with 3 Hard PRs and 4 claims (buffer exhausted at 4 claims)", async () => {
    // 3 Hard PRs = 60 potential points. claimsNeededToReachCap = 3.
    // Threshold = 4 claims. Member already holds 4 claims.
    const pullRequests = [
      { id: "pr-1", number: 101, countsForScore: true, openedAt: "2026-09-19T08:00:00Z", issue: { level: IssueLevel.hard } },
      { id: "pr-2", number: 102, countsForScore: true, openedAt: "2026-09-19T10:00:00Z", issue: { level: IssueLevel.hard } },
      { id: "pr-3", number: 103, countsForScore: true, openedAt: "2026-09-19T12:00:00Z", issue: { level: IssueLevel.hard } },
    ];

    const { db, postedComments, postReply } = buildMockDb({
      issue: { id: "issue-hard-3", spots: 2, level: IssueLevel.hard },
      member: makeMember({ id: "tech-1", tier: Tier.tech, department: Department.technical }),
      pullRequests,
      activeClaims: 1,
      committedClaimsCount: 4, // 4 claims held >= 4 threshold
    });

    const result = await processClaimComment(db, makeComment(), ISSUE_CTX, { postReply });
    expect(result.outcome).toBe("tier_cap_covered");
    const msg = (result as { message: string }).message;
    expect(msg).toContain("Your existing pull requests already cover your 60-point cap. You cannot claim more issues. Focus on the ones you have — quality decides which PRs are merged.");
    expect(postedComments.some((c) => c.kind === "claim_tier_cap_covered")).toBe(true);
    expect(postedComments[0]!.body).toContain("Your existing pull requests already cover your 60-point cap. You cannot claim more issues. Focus on the ones you have — quality decides which PRs are merged.");
  });

  it("allows a general member with 3 Easy + 1 Medium PRs to still claim (potential points 45 < 80 cap)", async () => {
    // 3 Easy PRs (3 * 10 = 30) + 1 Medium PR (15) = 45 potential points < 80 cap.
    const pullRequests = [
      { id: "pr-1", number: 201, countsForScore: true, openedAt: "2026-09-19T08:00:00Z", issue: { level: IssueLevel.easy } },
      { id: "pr-2", number: 202, countsForScore: true, openedAt: "2026-09-19T09:00:00Z", issue: { level: IssueLevel.easy } },
      { id: "pr-3", number: 203, countsForScore: true, openedAt: "2026-09-19T10:00:00Z", issue: { level: IssueLevel.easy } },
      { id: "pr-4", number: 204, countsForScore: true, openedAt: "2026-09-19T11:00:00Z", issue: { level: IssueLevel.medium } },
    ];

    const { db, postReply } = buildMockDb({
      issue: { id: "issue-med-10", spots: 2, level: IssueLevel.medium },
      member: makeMember({ id: "gen-1", tier: Tier.general, department: Department.pr }),
      pullRequests,
      activeClaims: 0,
      easyClaimsCount: 3,
      committedClaimsCount: 4,
    });

    const result = await processClaimComment(db, makeComment(), ISSUE_CTX, { postReply });
    expect(result.outcome).toBe("accepted");
  });

  it("fires 2-active-claims limit independently even if potential points are low", async () => {
    const pullRequests = [
      { id: "pr-1", number: 301, countsForScore: true, openedAt: "2026-09-19T08:00:00Z", issue: { level: IssueLevel.medium } },
    ];

    const { db, postedComments, postReply } = buildMockDb({
      issue: { id: "issue-med-11", spots: 2, level: IssueLevel.medium },
      member: makeMember({ id: "gen-2", tier: Tier.general, department: Department.pr }),
      pullRequests,
      activeClaims: 2, // 2 active claims already held
      committedClaimsCount: 3,
    });

    const result = await processClaimComment(db, makeComment(), ISSUE_CTX, { postReply });
    expect(result.outcome).toBe("active_claims_limit");
    expect(postedComments.some((c) => c.kind === "claim_active_limit")).toBe(true);
  });

  it("fires 3-Easy lifetime limit independently even if potential points are low", async () => {
    const pullRequests = [
      { id: "pr-1", number: 401, countsForScore: true, openedAt: "2026-09-19T08:00:00Z", issue: { level: IssueLevel.easy } },
    ];

    const { db, postedComments, postReply } = buildMockDb({
      issue: { id: "issue-easy-99", spots: 1, level: IssueLevel.easy },
      member: makeMember({ id: "gen-3", tier: Tier.general, department: Department.pr }),
      pullRequests,
      activeClaims: 0,
      easyClaimsCount: 3, // 3 Easy claims already used
      committedClaimsCount: 3,
    });

    const result = await processClaimComment(db, makeComment(), ISSUE_CTX, { postReply });
    expect(result.outcome).toBe("easy_limit");
    expect(postedComments.some((c) => c.kind === "claim_easy_limit")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mid-event rule: Hard issue limit for General tier (max 2 lifetime Hard claims)
// ---------------------------------------------------------------------------

describe("Mid-event rule: Hard issue limit for General tier (max 3 Hard claims)", () => {
  it("allows a general member with 2 Hard claims to claim a third Hard issue", async () => {
    const { db, postReply } = buildMockDb({
      issue: { id: "issue-hard-10", spots: 2, level: IssueLevel.hard },
      member: makeMember({ id: "gen-1", tier: Tier.general, department: Department.pr }),
      hardClaimsCount: 2, // 2 previous Hard claims < 3 limit
      activeClaims: 0,
      committedClaimsCount: 2,
    });

    const result = await processClaimComment(db, makeComment(), ISSUE_CTX, { postReply });
    expect(result.outcome).toBe("accepted");
    expect((result as { deadline: Date }).deadline).toBeInstanceOf(Date);
  });

  it("rejects a general member with 3 Hard claims when claiming a 4th Hard issue", async () => {
    const { db, postedComments, postReply } = buildMockDb({
      issue: { id: "issue-hard-11", spots: 2, level: IssueLevel.hard },
      member: makeMember({ id: "gen-2", tier: Tier.general, department: Department.pr }),
      hardClaimsCount: 3, // already at 3 Hard claims limit
      activeClaims: 0,
      committedClaimsCount: 3,
    });

    const result = await processClaimComment(db, makeComment(), ISSUE_CTX, { postReply });
    expect(result.outcome).toBe("hard_limit");
    const msg = (result as { message: string }).message;
    expect(msg).toContain("General members may claim at most 3 Hard issues. You already have 3. Medium issues are still open to you — 3 Easy plus 4 Medium reaches the 80-point cap.");
    expect(postedComments.some((c) => c.kind === "claim_hard_limit")).toBe(true);
    expect(postedComments[0]!.body).toContain("General members may claim at most 3 Hard issues. You already have 3. Medium issues are still open to you — 3 Easy plus 4 Medium reaches the 80-point cap.");
  });

  it("does NOT reject a tech member with 4 Hard claims by this rule (unrestricted on Hard)", async () => {
    // Tech member with 4 Hard claims, not blocked by cap rule because no PRs / low points
    const { db, postReply } = buildMockDb({
      issue: { id: "issue-hard-12", spots: 2, level: IssueLevel.hard },
      member: makeMember({ id: "tech-99", tier: Tier.tech, department: Department.technical }),
      hardClaimsCount: 4, // Tech members are unrestricted on Hard claims
      activeClaims: 0,
      committedClaimsCount: 4,
    });

    const result = await processClaimComment(db, makeComment(), ISSUE_CTX, { postReply });
    expect(result.outcome).toBe("accepted");
  });

  it("fires Easy limit, 2-active limit, and potential-cap rule independently", async () => {
    // 1. Easy limit still fires for Easy issue
    const { db: easyDb, postReply: easyReply } = buildMockDb({
      issue: { id: "issue-easy-50", spots: 1, level: IssueLevel.easy },
      member: makeMember({ id: "gen-x", tier: Tier.general }),
      easyClaimsCount: 3,
      hardClaimsCount: 0,
      activeClaims: 0,
      committedClaimsCount: 3,
    });
    const easyRes = await processClaimComment(easyDb, makeComment(), ISSUE_CTX, { postReply: easyReply });
    expect(easyRes.outcome).toBe("easy_limit");

    // 2. 2-active limit still fires on Medium issue
    const { db: activeDb, postReply: activeReply } = buildMockDb({
      issue: { id: "issue-med-50", spots: 2, level: IssueLevel.medium },
      member: makeMember({ id: "gen-y", tier: Tier.general }),
      hardClaimsCount: 1,
      activeClaims: 2,
      committedClaimsCount: 2,
    });
    const activeRes = await processClaimComment(activeDb, makeComment(), ISSUE_CTX, { postReply: activeReply });
    expect(activeRes.outcome).toBe("active_claims_limit");

    // 3. Potential cap rule fires on Medium issue when cap is reached
    const pullRequests = [
      { id: "pr-1", number: 1, countsForScore: true, openedAt: "2026-09-19T08:00:00Z", issue: { level: IssueLevel.hard } },
      { id: "pr-2", number: 2, countsForScore: true, openedAt: "2026-09-19T09:00:00Z", issue: { level: IssueLevel.hard } },
      { id: "pr-3", number: 3, countsForScore: true, openedAt: "2026-09-19T10:00:00Z", issue: { level: IssueLevel.hard } },
      { id: "pr-4", number: 4, countsForScore: true, openedAt: "2026-09-19T11:00:00Z", issue: { level: IssueLevel.hard } },
    ]; // 80 potential points for general member (cap reached with 4 Hard PRs)
    const { db: capDb, postReply: capReply } = buildMockDb({
      issue: { id: "issue-med-51", spots: 2, level: IssueLevel.medium },
      member: makeMember({ id: "gen-z", tier: Tier.general }),
      pullRequests,
      hardClaimsCount: 2,
      activeClaims: 1,
      committedClaimsCount: 5, // 4 + 1 = 5 threshold reached
    });
    const capRes = await processClaimComment(capDb, makeComment(), ISSUE_CTX, { postReply: capReply });
    expect(capRes.outcome).toBe("tier_cap_covered");
  });
});
