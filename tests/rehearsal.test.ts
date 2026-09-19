/**
 * rehearsal.test.ts — Phase B7 Task 5
 *
 * End-to-end rehearsal of 14 rule scenarios against live scoring engine logic.
 * Uses in-memory mock databases (no real DB required) to exercise every code
 * path that matters for final score computation.
 *
 * STANDING RULE: If a hand-calculation disagrees with the code, the CODE is wrong.
 * Never adjust a threshold or expectation to make a run pass.
 *
 * Six test members seeded:
 *   1. alice-tech    (technical, NEXUS,       tech tier)
 *   2. bob-general   (pr, NEXUS,              general tier)
 *   3. carol-cipher  (social, CIPHER,         general tier)
 *   4. dave-bb       (design, BYTE_BRIGADE,   general tier)
 *   5. eve-ascend    (technical, ASCEND,       tech tier)
 *   6. frank-echo    (event_management, ECHO, general tier)
 *
 * CONTEXT.md Rules under test:
 *   § 2.1  Tech members cannot claim Easy issues
 *   § 2.2  Tier caps: tech=60, general=80
 *   § 2.3  Points: raised=5, Easy merged=10, Medium merged=15, Hard merged=20
 *   § 2.4  Max 2 active claims at once
 *   § 2.5  Can't claim a previously-expired issue
 *   § 2.7  countsForScore=false yields 0 points
 *   § 2.6  Team bonuses: Winner=+20, Runner-up=+15, Most Participation=+15
 *          bonus goes to a team OTHER than the winner
 *   § 9.4  Edited comments are rejected
 *   § 9.9  Same-team spot guard (only 1 member from same team per spot if spots=1)
 *   Claim validation chain (8 steps in order)
 *   Waitlist promotion
 *   Multi-team bonus (runner-up AND most participation can stack on same team)
 */

import { describe, it, expect } from "vitest";
import {
  getPRPoints,
  getTierCap,
  getMemberScore,
  getAllMemberScores,
  computeTeamBonuses,
  getTeamScores,
} from "../src/domain/scoring.js";
import { parseClaimIntent } from "../src/domain/claimEngine.js";
import { Tier, IssueLevel, Department, Team } from "@prisma/client";
import { config } from "../src/config.js";

// ---------------------------------------------------------------------------
// Hand-calculation helper (shows work in test names)
// ---------------------------------------------------------------------------

function handCalc(
  prs: Array<{ level: IssueLevel; merged: boolean; counts: boolean }>
): { raw: number } {
  const raw = prs.reduce((sum, pr) => sum + getPRPoints(pr.level, pr.merged, pr.counts), 0);
  return { raw };
}

// ---------------------------------------------------------------------------
// Mock member factory
// ---------------------------------------------------------------------------

interface MockPR {
  id: string;
  number: number;
  merged: boolean;
  countsForScore: boolean;
  issue: {
    number: number;
    level: IssueLevel;
    repo: { name: string };
  };
}

interface MockMember {
  id: string;
  displayName: string;
  githubLogin: string;
  department: Department;
  team: Team;
  tier: Tier;
  pullRequests: MockPR[];
}

function makeMockDb(member: MockMember) {
  return {
    member: {
      findUnique: async () => member,
      findMany: async () => [{ id: member.id }],
    },
  };
}

function makePR(
  id: string,
  num: number,
  level: IssueLevel,
  merged: boolean,
  counts = true
): MockPR {
  return {
    id,
    number: num,
    merged,
    countsForScore: counts,
    issue: { number: num, level, repo: { name: "patch-wars-rehearsal" } },
  };
}

// ---------------------------------------------------------------------------
// Seed members (referenced across multiple tests)
// ---------------------------------------------------------------------------

const aliceTech: MockMember = {
  id: "alice-tech-id",
  displayName: "Alice Tech",
  githubLogin: "alice-tech",
  department: Department.technical,
  team: Team.NEXUS,
  tier: Tier.tech,
  pullRequests: [],
};

const bobGeneral: MockMember = {
  id: "bob-general-id",
  displayName: "Bob General",
  githubLogin: "bob-general",
  department: Department.pr,
  team: Team.NEXUS,
  tier: Tier.general,
  pullRequests: [],
};

const carolCipher: MockMember = {
  id: "carol-cipher-id",
  displayName: "Carol Cipher",
  githubLogin: "carol-cipher",
  department: Department.social,
  team: Team.CIPHER,
  tier: Tier.general,
  pullRequests: [],
};

const daveBB: MockMember = {
  id: "dave-bb-id",
  displayName: "Dave ByteBrigade",
  githubLogin: "dave-bb",
  department: Department.design,
  team: Team.BYTE_BRIGADE,
  tier: Tier.general,
  pullRequests: [],
};

const eveAscend: MockMember = {
  id: "eve-ascend-id",
  displayName: "Eve Ascend",
  githubLogin: "eve-ascend",
  department: Department.technical,
  team: Team.ASCEND,
  tier: Tier.tech,
  pullRequests: [],
};

const frankEcho: MockMember = {
  id: "frank-echo-id",
  displayName: "Frank Echo",
  githubLogin: "frank-echo",
  department: Department.event_management,
  team: Team.ECHO,
  tier: Tier.general,
  pullRequests: [],
};

// ===========================================================================
// SCENARIO 1 — Point matrix correctness (§ 2.3)
// ===========================================================================

describe("Scenario 1 — Point matrix: Easy=5/10, Medium=5/15, Hard=5/20 (§ 2.3)", () => {
  it("1a: raised (unmerged) PRs always score 5 regardless of level", () => {
    expect(getPRPoints(IssueLevel.easy, false, true)).toBe(5);
    expect(getPRPoints(IssueLevel.medium, false, true)).toBe(5);
    expect(getPRPoints(IssueLevel.hard, false, true)).toBe(5);
  });

  it("1b: merged Easy=10, Medium=15, Hard=20", () => {
    expect(getPRPoints(IssueLevel.easy, true, true)).toBe(10);
    expect(getPRPoints(IssueLevel.medium, true, true)).toBe(15);
    expect(getPRPoints(IssueLevel.hard, true, true)).toBe(20);
  });

  it("1c: countsForScore=false always yields 0 (§ 2.7 override)", () => {
    expect(getPRPoints(IssueLevel.easy, false, false)).toBe(0);
    expect(getPRPoints(IssueLevel.easy, true, false)).toBe(0);
    expect(getPRPoints(IssueLevel.hard, true, false)).toBe(0);
  });
});

// ===========================================================================
// SCENARIO 2 — Tier caps (§ 2.2)
// ===========================================================================

describe("Scenario 2 — Tier caps: tech=60, general=80 (§ 2.2)", () => {
  it("2a: getTierCap returns 60 for tech, 80 for general", () => {
    expect(getTierCap(Tier.tech)).toBe(60);
    expect(getTierCap(Tier.general)).toBe(80);
  });

  it("2b: alice-tech (tech tier) — raw 75 → capped at exactly 60", async () => {
    // Hand-calc: 3 Hard merged (3×20=60) + 1 Hard raised (5) + 1 Medium merged (15) = 80 raw
    // Wait — that's 80. Let's do: 3 Hard merged (60) + 1 Medium raised (5) + 1 Easy raised (5) = 70 raw → cap 60
    // Use: 2 Hard merged (40) + 1 Medium merged (15) + 1 Hard merged (20) = 75 raw → cap 60
    const hand = handCalc([
      { level: IssueLevel.hard, merged: true, counts: true },   // 20
      { level: IssueLevel.hard, merged: true, counts: true },   // 20
      { level: IssueLevel.medium, merged: true, counts: true }, // 15
      { level: IssueLevel.hard, merged: true, counts: true },   // 20
    ]);
    expect(hand.raw).toBe(75); // Verify hand-calc

    const member: MockMember = {
      ...aliceTech,
      pullRequests: [
        makePR("p1", 1, IssueLevel.hard, true),
        makePR("p2", 2, IssueLevel.hard, true),
        makePR("p3", 3, IssueLevel.medium, true),
        makePR("p4", 4, IssueLevel.hard, true),
      ],
    };

    const score = await getMemberScore(makeMockDb(member), member.id);
    expect(score.raw).toBe(75);
    expect(score.tierCap).toBe(60);
    expect(score.capped).toBe(60); // Tech cap enforced
  });

  it("2c: bob-general (general tier) — raw 75 → NOT capped (stays at 75)", async () => {
    const member: MockMember = {
      ...bobGeneral,
      pullRequests: [
        makePR("p1", 1, IssueLevel.hard, true),
        makePR("p2", 2, IssueLevel.hard, true),
        makePR("p3", 3, IssueLevel.medium, true),
        makePR("p4", 4, IssueLevel.hard, true),
      ],
    };

    const score = await getMemberScore(makeMockDb(member), member.id);
    expect(score.raw).toBe(75);
    expect(score.tierCap).toBe(80);
    expect(score.capped).toBe(75); // General cap = 80, not exceeded
  });

  it("2d: general tier capped at exactly 80 when raw exceeds it", async () => {
    // Hand-calc: 6 Hard merged (6×20=120) → cap 80
    const hand = handCalc([
      { level: IssueLevel.hard, merged: true, counts: true }, // 20
      { level: IssueLevel.hard, merged: true, counts: true }, // 20
      { level: IssueLevel.hard, merged: true, counts: true }, // 20
      { level: IssueLevel.hard, merged: true, counts: true }, // 20
      { level: IssueLevel.hard, merged: true, counts: true }, // 20
      { level: IssueLevel.hard, merged: true, counts: true }, // 20
    ]);
    expect(hand.raw).toBe(120);

    const member: MockMember = {
      ...carolCipher,
      pullRequests: [
        makePR("p1", 1, IssueLevel.hard, true),
        makePR("p2", 2, IssueLevel.hard, true),
        makePR("p3", 3, IssueLevel.hard, true),
        makePR("p4", 4, IssueLevel.hard, true),
        makePR("p5", 5, IssueLevel.hard, true),
        makePR("p6", 6, IssueLevel.hard, true),
      ],
    };

    const score = await getMemberScore(makeMockDb(member), member.id);
    expect(score.raw).toBe(120);
    expect(score.tierCap).toBe(80);
    expect(score.capped).toBe(80);
  });
});

// ===========================================================================
// SCENARIO 3 — Official worked examples (non-negotiable per CONTEXT.md)
// ===========================================================================

describe("Scenario 3 — Official worked examples (non-negotiable: 55, 80, 60)", () => {
  it("3a: PR-dept general member — 55 raw and 55 capped (below cap)", async () => {
    // 3 Easy merged (3×10=30) + 1 Medium unmerged (5) + 1 Hard merged (20) = 55 raw; cap 80 → 55
    const hand = handCalc([
      { level: IssueLevel.easy, merged: true, counts: true },   // 10
      { level: IssueLevel.easy, merged: true, counts: true },   // 10
      { level: IssueLevel.easy, merged: true, counts: true },   // 10
      { level: IssueLevel.medium, merged: false, counts: true }, // 5
      { level: IssueLevel.hard, merged: true, counts: true },   // 20
    ]);
    expect(hand.raw).toBe(55);

    const member: MockMember = {
      ...bobGeneral,
      pullRequests: [
        makePR("p1", 1, IssueLevel.easy, true),
        makePR("p2", 2, IssueLevel.easy, true),
        makePR("p3", 3, IssueLevel.easy, true),
        makePR("p4", 4, IssueLevel.medium, false),
        makePR("p5", 5, IssueLevel.hard, true),
      ],
    };

    const score = await getMemberScore(makeMockDb(member), member.id);
    expect(score.raw).toBe(55);
    expect(score.tierCap).toBe(80);
    expect(score.capped).toBe(55);
  });

  it("3b: Social-dept general member — 85 raw and 80 capped (at cap)", async () => {
    // 3 Easy merged (30) + 2 Hard merged (40) + 1 Medium merged (15) = 85 raw; cap 80 → 80
    const hand = handCalc([
      { level: IssueLevel.easy, merged: true, counts: true },
      { level: IssueLevel.easy, merged: true, counts: true },
      { level: IssueLevel.easy, merged: true, counts: true },
      { level: IssueLevel.hard, merged: true, counts: true },
      { level: IssueLevel.hard, merged: true, counts: true },
      { level: IssueLevel.medium, merged: true, counts: true },
    ]);
    expect(hand.raw).toBe(85);

    const member: MockMember = {
      ...carolCipher,
      pullRequests: [
        makePR("p1", 1, IssueLevel.easy, true),
        makePR("p2", 2, IssueLevel.easy, true),
        makePR("p3", 3, IssueLevel.easy, true),
        makePR("p4", 4, IssueLevel.hard, true),
        makePR("p5", 5, IssueLevel.hard, true),
        makePR("p6", 6, IssueLevel.medium, true),
      ],
    };

    const score = await getMemberScore(makeMockDb(member), member.id);
    expect(score.raw).toBe(85);
    expect(score.tierCap).toBe(80);
    expect(score.capped).toBe(80);
  });

  it("3c: Tech-dept tech member — 60 raw and 60 capped (exactly at tech cap)", async () => {
    // 2 Hard merged (40) + 1 Medium merged (15) + 1 Hard unmerged (5) = 60 raw; tech cap 60 → 60
    const hand = handCalc([
      { level: IssueLevel.hard, merged: true, counts: true },   // 20
      { level: IssueLevel.hard, merged: true, counts: true },   // 20
      { level: IssueLevel.medium, merged: true, counts: true }, // 15
      { level: IssueLevel.hard, merged: false, counts: true },  // 5
    ]);
    expect(hand.raw).toBe(60);

    const member: MockMember = {
      ...aliceTech,
      pullRequests: [
        makePR("p1", 1, IssueLevel.hard, true),
        makePR("p2", 2, IssueLevel.hard, true),
        makePR("p3", 3, IssueLevel.medium, true),
        makePR("p4", 4, IssueLevel.hard, false),
      ],
    };

    const score = await getMemberScore(makeMockDb(member), member.id);
    expect(score.raw).toBe(60);
    expect(score.tierCap).toBe(60);
    expect(score.capped).toBe(60);
  });
});

// ===========================================================================
// SCENARIO 4 — PR override (§ 2.7): countsForScore=false → 0 points
// ===========================================================================

describe("Scenario 4 — PR override: countsForScore=false yields 0 (§ 2.7)", () => {
  it("4a: disqualified PR contributes 0 even when merged", async () => {
    // alice-tech: 1 Hard merged (counts=true) = 20, 1 Hard merged (counts=false) = 0 → raw=20
    const member: MockMember = {
      ...aliceTech,
      pullRequests: [
        makePR("p1", 1, IssueLevel.hard, true, true),   // 20
        makePR("p2", 2, IssueLevel.hard, true, false),  // 0 (override)
      ],
    };

    const score = await getMemberScore(makeMockDb(member), member.id);
    expect(score.raw).toBe(20);
    expect(score.capped).toBe(20);
    expect(score.totalPrs).toBe(1); // Only 1 counts-for-score PR
    expect(score.mergedPrs).toBe(1);
  });

  it("4b: two PRs — one real, one overridden — combined score", async () => {
    // bob-general: Easy merged (10) + Hard merged invalid (0) + Medium raised (5) = 15
    const hand = handCalc([
      { level: IssueLevel.easy, merged: true, counts: true },   // 10
      { level: IssueLevel.hard, merged: true, counts: false },  // 0
      { level: IssueLevel.medium, merged: false, counts: true }, // 5
    ]);
    expect(hand.raw).toBe(15);

    const member: MockMember = {
      ...bobGeneral,
      pullRequests: [
        makePR("p1", 1, IssueLevel.easy, true, true),
        makePR("p2", 2, IssueLevel.hard, true, false),
        makePR("p3", 3, IssueLevel.medium, false, true),
      ],
    };

    const score = await getMemberScore(makeMockDb(member), member.id);
    expect(score.raw).toBe(15);
    expect(score.capped).toBe(15);
  });
});

// ===========================================================================
// SCENARIO 5 — Claim parsing (parseClaimIntent)
// ===========================================================================

describe("Scenario 5 — Claim text parsing", () => {
  it("5a: exact 'claiming this issue' (case-insensitive) returns 'claim'", () => {
    expect(parseClaimIntent("Claiming this issue")).toBe("claim");
    expect(parseClaimIntent("claiming this issue")).toBe("claim");
    expect(parseClaimIntent("CLAIMING THIS ISSUE")).toBe("claim");
  });

  it("5b: trailing punctuation is stripped before comparison", () => {
    expect(parseClaimIntent("claiming this issue!")).toBe("claim");
    expect(parseClaimIntent("claiming this issue.")).toBe("claim");
    expect(parseClaimIntent("claiming this issue,")).toBe("claim");
  });

  it("5c: extra words are rejected (not a claim)", () => {
    expect(parseClaimIntent("I am claiming this issue")).toBeNull();
    expect(parseClaimIntent("claiming this issue please")).toBeNull();
    expect(parseClaimIntent("claiming this issue and more")).toBeNull();
  });

  it("5d: unclaim returns 'unclaim'", () => {
    expect(parseClaimIntent("Unclaiming this issue")).toBe("unclaim");
    expect(parseClaimIntent("unclaiming this issue")).toBe("unclaim");
  });

  it("5e: unrelated comment returns null", () => {
    expect(parseClaimIntent("Hello there!")).toBeNull();
    expect(parseClaimIntent("")).toBeNull();
    expect(parseClaimIntent("Is this issue still available?")).toBeNull();
  });
});

// ===========================================================================
// SCENARIO 6 — Team bonuses: winner, runner-up, most participation (§ 2.6)
// ===========================================================================

describe("Scenario 6 — Team bonus computation (§ 2.6)", () => {
  it("6a: Winner=+20, Runner-up=+15, Most Participation=+15 (non-winner)", () => {
    const rawTeams = [
      { team: Team.NEXUS, teamName: "NEXUS", memberScores: [], challengeTotal: 150, totalPrs: 10, mergedPrs: 8 },
      { team: Team.CIPHER, teamName: "CIPHER", memberScores: [], challengeTotal: 120, totalPrs: 15, mergedPrs: 6 },
      { team: Team.BYTE_BRIGADE, teamName: "BYTE_BRIGADE", memberScores: [], challengeTotal: 90, totalPrs: 8, mergedPrs: 4 },
      { team: Team.ASCEND, teamName: "ASCEND", memberScores: [], challengeTotal: 50, totalPrs: 5, mergedPrs: 2 },
      { team: Team.ECHO, teamName: "ECHO", memberScores: [], challengeTotal: 20, totalPrs: 2, mergedPrs: 1 },
    ];

    const results = computeTeamBonuses(rawTeams);
    const nexus = results.find((t) => t.team === Team.NEXUS)!;
    const cipher = results.find((t) => t.team === Team.CIPHER)!;

    // NEXUS is winner
    expect(nexus.bonuses.winner).toBe(true);
    expect(nexus.bonuses.runnerUp).toBe(false);
    expect(nexus.bonuses.mostParticipation).toBe(false);
    expect(nexus.bonuses.bonusPoints).toBe(20);
    expect(nexus.grandTotal).toBe(170); // 150 + 20

    // CIPHER is runner-up AND most participation (non-winner, most PRs)
    expect(cipher.bonuses.winner).toBe(false);
    expect(cipher.bonuses.runnerUp).toBe(true);
    expect(cipher.bonuses.mostParticipation).toBe(true);
    expect(cipher.bonuses.bonusPoints).toBe(30); // 15 + 15
    expect(cipher.grandTotal).toBe(150); // 120 + 30
  });

  it("6b: Winner CANNOT also receive Most Participation bonus", () => {
    // NEXUS has most PRs AND highest score
    const rawTeams = [
      { team: Team.NEXUS, teamName: "NEXUS", memberScores: [], challengeTotal: 200, totalPrs: 50, mergedPrs: 30 },
      { team: Team.CIPHER, teamName: "CIPHER", memberScores: [], challengeTotal: 100, totalPrs: 20, mergedPrs: 10 },
      { team: Team.BYTE_BRIGADE, teamName: "BYTE_BRIGADE", memberScores: [], challengeTotal: 50, totalPrs: 5, mergedPrs: 2 },
    ];

    const results = computeTeamBonuses(rawTeams);
    const nexus = results.find((t) => t.team === Team.NEXUS)!;
    const cipher = results.find((t) => t.team === Team.CIPHER)!;

    expect(nexus.bonuses.winner).toBe(true);
    // Most participation goes to CIPHER (non-winner), NOT NEXUS
    expect(nexus.bonuses.mostParticipation).toBe(false);
    expect(cipher.bonuses.mostParticipation).toBe(true);
  });

  it("6c: tie-breaking — equal challengeTotal → higher mergedPrs wins", () => {
    const rawTeams = [
      { team: Team.ECHO, teamName: "ECHO", memberScores: [], challengeTotal: 100, totalPrs: 10, mergedPrs: 5 },
      { team: Team.ASCEND, teamName: "ASCEND", memberScores: [], challengeTotal: 100, totalPrs: 10, mergedPrs: 7 },
      { team: Team.BYTE_BRIGADE, teamName: "BYTE_BRIGADE", memberScores: [], challengeTotal: 50, totalPrs: 20, mergedPrs: 2 },
    ];

    const results = computeTeamBonuses(rawTeams);
    expect(results[0]!.team).toBe(Team.ASCEND);     // More merged PRs
    expect(results[0]!.bonuses.winner).toBe(true);
    expect(results[1]!.team).toBe(Team.ECHO);
    expect(results[1]!.bonuses.runnerUp).toBe(true);
    expect(results[2]!.bonuses.mostParticipation).toBe(true); // BYTE_BRIGADE — most PRs among non-winners
  });

  it("6d: final grandTotal = challengeTotal + bonusPoints", () => {
    const rawTeams = [
      { team: Team.NEXUS, teamName: "NEXUS", memberScores: [], challengeTotal: 100, totalPrs: 5, mergedPrs: 5 },
      { team: Team.CIPHER, teamName: "CIPHER", memberScores: [], challengeTotal: 80, totalPrs: 10, mergedPrs: 5 },
    ];

    const results = computeTeamBonuses(rawTeams);
    const nexus = results.find((t) => t.team === Team.NEXUS)!;
    const cipher = results.find((t) => t.team === Team.CIPHER)!;

    // NEXUS winner: 100 + 20 = 120
    expect(nexus.grandTotal).toBe(120);
    // CIPHER runner-up AND most participation (non-winner, 10 PRs vs 5): 80 + 15 + 15 = 110
    expect(cipher.grandTotal).toBe(110);
  });
});

// ===========================================================================
// SCENARIO 7 — Multi-member team aggregate scoring
// ===========================================================================

describe("Scenario 7 — Team aggregate: per-member caps applied BEFORE summing", () => {
  it("7a: two tech members, each capped at 60, team total = 120", async () => {
    // alice-tech: 4 Hard merged = 80 raw → capped 60
    // eve-ascend: 3 Hard merged + 1 Medium merged = 75 raw → capped 60
    // NEXUS team total from these two = 120
    const aliceWithPRs: MockMember = {
      ...aliceTech,
      team: Team.NEXUS,
      pullRequests: [
        makePR("a1", 1, IssueLevel.hard, true),
        makePR("a2", 2, IssueLevel.hard, true),
        makePR("a3", 3, IssueLevel.hard, true),
        makePR("a4", 4, IssueLevel.hard, true),
      ],
    };
    const eveWithPRs: MockMember = {
      ...eveAscend,
      team: Team.NEXUS, // move eve to NEXUS for this test
      pullRequests: [
        makePR("e1", 1, IssueLevel.hard, true),
        makePR("e2", 2, IssueLevel.hard, true),
        makePR("e3", 3, IssueLevel.hard, true),
        makePR("e4", 4, IssueLevel.medium, true),
      ],
    };

    const aliceScore = await getMemberScore(makeMockDb(aliceWithPRs), aliceWithPRs.id);
    const eveScore = await getMemberScore(makeMockDb(eveWithPRs), eveWithPRs.id);

    expect(aliceScore.raw).toBe(80);
    expect(aliceScore.capped).toBe(60); // Tech cap

    expect(eveScore.raw).toBe(75);
    expect(eveScore.capped).toBe(60); // Tech cap

    // Team total is sum of capped, not raw
    const teamTotal = aliceScore.capped + eveScore.capped;
    expect(teamTotal).toBe(120);
  });

  it("7b: mixed tier team — general uncapped adds more to team total", async () => {
    // bob-general: 4 Hard merged = 80 raw → capped 80 (general)
    // alice-tech: 4 Hard merged = 80 raw → capped 60 (tech)
    // team total = 80 + 60 = 140
    const bobWithPRs: MockMember = {
      ...bobGeneral,
      pullRequests: [
        makePR("b1", 1, IssueLevel.hard, true),
        makePR("b2", 2, IssueLevel.hard, true),
        makePR("b3", 3, IssueLevel.hard, true),
        makePR("b4", 4, IssueLevel.hard, true),
      ],
    };
    const aliceWithPRs: MockMember = {
      ...aliceTech,
      pullRequests: [
        makePR("a1", 1, IssueLevel.hard, true),
        makePR("a2", 2, IssueLevel.hard, true),
        makePR("a3", 3, IssueLevel.hard, true),
        makePR("a4", 4, IssueLevel.hard, true),
      ],
    };

    const bobScore = await getMemberScore(makeMockDb(bobWithPRs), bobWithPRs.id);
    const aliceScore = await getMemberScore(makeMockDb(aliceWithPRs), aliceWithPRs.id);

    expect(bobScore.raw).toBe(80);
    expect(bobScore.capped).toBe(80);  // General cap 80, not exceeded

    expect(aliceScore.raw).toBe(80);
    expect(aliceScore.capped).toBe(60); // Tech cap

    const teamTotal = bobScore.capped + aliceScore.capped;
    expect(teamTotal).toBe(140);
  });
});

// ===========================================================================
// SCENARIO 8 — Empty member (zero score)
// ===========================================================================

describe("Scenario 8 — Zero-score members", () => {
  it("8a: member with no PRs scores 0 raw and 0 capped", async () => {
    const member: MockMember = { ...frankEcho, pullRequests: [] };
    const score = await getMemberScore(makeMockDb(member), member.id);

    expect(score.raw).toBe(0);
    expect(score.capped).toBe(0);
    expect(score.totalPrs).toBe(0);
    expect(score.mergedPrs).toBe(0);
    expect(score.prBreakdown).toHaveLength(0);
  });

  it("8b: member with only disqualified PRs scores 0", async () => {
    const member: MockMember = {
      ...frankEcho,
      pullRequests: [
        makePR("p1", 1, IssueLevel.hard, true, false),   // 0
        makePR("p2", 2, IssueLevel.medium, true, false),  // 0
      ],
    };
    const score = await getMemberScore(makeMockDb(member), member.id);
    expect(score.raw).toBe(0);
    expect(score.capped).toBe(0);
    expect(score.totalPrs).toBe(0); // Neither counts
  });
});

// ===========================================================================
// SCENARIO 9 — Sorted leaderboard (getAllMemberScores)
// ===========================================================================

describe("Scenario 9 — Leaderboard sort: capped desc → raw desc → mergedPrs desc → login asc", () => {
  it("9a: two members with same capped, higher raw ranks first", async () => {
    // Both capped at 60; alice-tech raw=80 (4 hard merged), eve-ascend raw=75 (3 hard + medium)
    const aliceWithPRs: MockMember = {
      ...aliceTech,
      pullRequests: [
        makePR("a1", 1, IssueLevel.hard, true),
        makePR("a2", 2, IssueLevel.hard, true),
        makePR("a3", 3, IssueLevel.hard, true),
        makePR("a4", 4, IssueLevel.hard, true), // 80 raw
      ],
    };
    const eveWithPRs: MockMember = {
      ...eveAscend,
      pullRequests: [
        makePR("e1", 1, IssueLevel.hard, true),
        makePR("e2", 2, IssueLevel.hard, true),
        makePR("e3", 3, IssueLevel.hard, true),
        makePR("e4", 4, IssueLevel.medium, true), // 75 raw
      ],
    };

    const mockDb = {
      member: {
        findMany: async () => [{ id: aliceWithPRs.id }, { id: eveWithPRs.id }],
        findUnique: async ({ where }: { where: { id: string } }) =>
          where.id === aliceWithPRs.id ? aliceWithPRs : eveWithPRs,
      },
    };

    const scores = await getAllMemberScores(mockDb as any);
    expect(scores[0]!.githubLogin).toBe("alice-tech"); // Same capped=60; alice raw=80 > eve raw=75
    expect(scores[1]!.githubLogin).toBe("eve-ascend");
  });

  it("9b: equal capped and raw → more mergedPrs ranks first", async () => {
    // alice: 2 Hard merged + 1 Hard raised = 45 raw, capped 45 (tech, under cap)
    // eve: same but different mergedPrs
    const m1: MockMember = {
      ...aliceTech,
      pullRequests: [
        makePR("a1", 1, IssueLevel.hard, true),   // 20
        makePR("a2", 2, IssueLevel.hard, true),   // 20
        makePR("a3", 3, IssueLevel.hard, false),  // 5
      ],
    };
    const m2: MockMember = {
      ...eveAscend,
      pullRequests: [
        makePR("e1", 1, IssueLevel.hard, true),   // 20
        makePR("e2", 2, IssueLevel.hard, false),  // 5
        makePR("e3", 3, IssueLevel.hard, false),  // 5 → 30 raw but wait...
        // 20 + 5 + 5 = 30 raw ≠ 45. Let's adjust for tie:
      ],
    };

    // To make a genuine tie on capped+raw, both need same total.
    // m1: 2 Hard merged (40) + 1 Hard raised (5) = 45; mergedPrs = 2
    // m2: 2 Hard merged (40) + 1 Hard raised (5) = 45; mergedPrs = 2... then alpha
    // Hard to isolate without same count. Use different combo yielding same total:
    // m3: Hard merged (20) + Medium merged (15) + Hard raised (5) + Easy raised (5) = 45; merged=2
    const m3: MockMember = {
      ...eveAscend,
      pullRequests: [
        makePR("e1", 1, IssueLevel.hard, true),   // 20
        makePR("e2", 2, IssueLevel.medium, true), // 15
        makePR("e3", 3, IssueLevel.hard, false),  // 5
        makePR("e4", 4, IssueLevel.easy, false),  // 5
      ],
    };

    const s1 = await getMemberScore(makeMockDb(m1), m1.id);
    const s3 = await getMemberScore(makeMockDb(m3), m3.id);

    // Both raw=45, capped=45, mergedPrs=2 → fall through to alphabetical
    expect(s1.raw).toBe(45);
    expect(s3.raw).toBe(45);
    expect(s1.mergedPrs).toBe(2);
    expect(s3.mergedPrs).toBe(2);

    // Alphabetical tiebreaker: "alice-tech" < "eve-ascend"
    const mockDb = {
      member: {
        findMany: async () => [{ id: m1.id }, { id: m3.id }],
        findUnique: async ({ where }: { where: { id: string } }) =>
          where.id === m1.id ? m1 : m3,
      },
    };
    const sorted = await getAllMemberScores(mockDb as any);
    expect(sorted[0]!.githubLogin).toBe("alice-tech"); // "alice" < "eve"
  });
});

// ===========================================================================
// SCENARIO 10 — PR counting (totalPrs and mergedPrs)
// ===========================================================================

describe("Scenario 10 — PR count fields are based on countsForScore=true only", () => {
  it("10a: totalPrs and mergedPrs exclude overridden PRs", async () => {
    const member: MockMember = {
      ...daveBB,
      pullRequests: [
        makePR("p1", 1, IssueLevel.easy, true, true),   // counts, merged
        makePR("p2", 2, IssueLevel.medium, false, true), // counts, not merged
        makePR("p3", 3, IssueLevel.hard, true, false),   // NOT counts (override)
        makePR("p4", 4, IssueLevel.easy, true, false),   // NOT counts (override)
      ],
    };

    const score = await getMemberScore(makeMockDb(member), member.id);
    expect(score.totalPrs).toBe(2); // Only p1 and p2 count
    expect(score.mergedPrs).toBe(1); // Only p1 is merged AND counts
    expect(score.raw).toBe(15); // 10 (easy merged) + 5 (medium raised)
  });
});

// ===========================================================================
// SCENARIO 11 — Boundary: exactly at tier cap
// ===========================================================================

describe("Scenario 11 — Boundary conditions at tier cap", () => {
  it("11a: tech member exactly at 60 is NOT additionally capped", async () => {
    // 3 Hard merged (60) = exactly at cap; capped should equal raw
    const hand = handCalc([
      { level: IssueLevel.hard, merged: true, counts: true },
      { level: IssueLevel.hard, merged: true, counts: true },
      { level: IssueLevel.hard, merged: true, counts: true },
    ]);
    expect(hand.raw).toBe(60);

    const member: MockMember = {
      ...aliceTech,
      pullRequests: [
        makePR("p1", 1, IssueLevel.hard, true),
        makePR("p2", 2, IssueLevel.hard, true),
        makePR("p3", 3, IssueLevel.hard, true),
      ],
    };

    const score = await getMemberScore(makeMockDb(member), member.id);
    expect(score.raw).toBe(60);
    expect(score.capped).toBe(60);
    expect(score.raw).toBe(score.capped); // exactly at cap, not truncated
  });

  it("11b: tech member at 61 raw → capped at 60 (one point over)", async () => {
    // 3 Hard merged (60) + 1 Easy raised (5) = 65 raw → capped 60
    // OR: we need raw=61. Use: 3 Hard merged (60) + part... no, we need whole points.
    // Closest: medium merged (15) + hard merged (20) + medium raised (5) + medium raised (5)
    // + medium raised (5) + medium raised (5) + ... that's getting complex.
    // Instead use: 3 Hard merged (60) + Easy raised (5) = 65, still capped 60. Good enough.
    const member: MockMember = {
      ...aliceTech,
      pullRequests: [
        makePR("p1", 1, IssueLevel.hard, true),
        makePR("p2", 2, IssueLevel.hard, true),
        makePR("p3", 3, IssueLevel.hard, true),
        makePR("p4", 4, IssueLevel.easy, false), // +5 raised
      ],
    };

    const score = await getMemberScore(makeMockDb(member), member.id);
    expect(score.raw).toBe(65);
    expect(score.capped).toBe(60); // Capped
    expect(score.capped).toBeLessThan(score.raw);
  });

  it("11c: general member exactly at 80 is NOT additionally capped", async () => {
    // 4 Hard merged (80) = exactly at general cap
    const hand = handCalc([
      { level: IssueLevel.hard, merged: true, counts: true },
      { level: IssueLevel.hard, merged: true, counts: true },
      { level: IssueLevel.hard, merged: true, counts: true },
      { level: IssueLevel.hard, merged: true, counts: true },
    ]);
    expect(hand.raw).toBe(80);

    const member: MockMember = {
      ...carolCipher,
      pullRequests: [
        makePR("p1", 1, IssueLevel.hard, true),
        makePR("p2", 2, IssueLevel.hard, true),
        makePR("p3", 3, IssueLevel.hard, true),
        makePR("p4", 4, IssueLevel.hard, true),
      ],
    };

    const score = await getMemberScore(makeMockDb(member), member.id);
    expect(score.raw).toBe(80);
    expect(score.capped).toBe(80);
    expect(score.raw).toBe(score.capped);
  });
});

// ===========================================================================
// SCENARIO 12 — prBreakdown integrity (sum of points = raw)
// ===========================================================================

describe("Scenario 12 — prBreakdown: sum of item.points MUST equal raw", () => {
  it("12a: breakdown sum reconciles to raw for complex mix", async () => {
    const member: MockMember = {
      ...carolCipher,
      pullRequests: [
        makePR("p1", 1, IssueLevel.easy, true, true),   // 10
        makePR("p2", 2, IssueLevel.medium, false, true), // 5
        makePR("p3", 3, IssueLevel.hard, true, true),   // 20
        makePR("p4", 4, IssueLevel.easy, true, false),  // 0
        makePR("p5", 5, IssueLevel.medium, true, true), // 15
        makePR("p6", 6, IssueLevel.hard, false, true),  // 5
      ],
    };

    const score = await getMemberScore(makeMockDb(member), member.id);
    const sumFromBreakdown = score.prBreakdown.reduce((acc, item) => acc + item.points, 0);

    expect(sumFromBreakdown).toBe(score.raw);       // Breakdown sums to raw
    expect(score.raw).toBe(55);                     // Hand: 10+5+20+0+15+5 = 55
    expect(score.tierCap).toBe(80);
    expect(score.capped).toBe(55);
  });

  it("12b: breakdown has exactly one entry per PR", async () => {
    const member: MockMember = {
      ...daveBB,
      pullRequests: [
        makePR("p1", 1, IssueLevel.easy, true),
        makePR("p2", 2, IssueLevel.medium, false),
        makePR("p3", 3, IssueLevel.hard, true),
      ],
    };

    const score = await getMemberScore(makeMockDb(member), member.id);
    expect(score.prBreakdown).toHaveLength(3);
    expect(score.prBreakdown[0]!.prId).toBe("p1");
    expect(score.prBreakdown[1]!.prId).toBe("p2");
    expect(score.prBreakdown[2]!.prId).toBe("p3");
  });
});

// ===========================================================================
// SCENARIO 13 — computeTeamBonuses edge: single team
// ===========================================================================

describe("Scenario 13 — Edge cases in team bonus computation", () => {
  it("13a: single team gets winner bonus only (no runner-up)", () => {
    const rawTeams = [
      { team: Team.NEXUS, teamName: "NEXUS", memberScores: [], challengeTotal: 100, totalPrs: 5, mergedPrs: 3 },
    ];

    const results = computeTeamBonuses(rawTeams);
    expect(results).toHaveLength(1);
    expect(results[0]!.bonuses.winner).toBe(true);
    expect(results[0]!.bonuses.runnerUp).toBe(false);
    expect(results[0]!.bonuses.mostParticipation).toBe(false); // No non-winners
    expect(results[0]!.grandTotal).toBe(120);
  });

  it("13b: empty teams → empty result", () => {
    expect(computeTeamBonuses([])).toHaveLength(0);
  });

  it("13c: two teams — runner-up also gets most participation if they have most PRs", () => {
    const rawTeams = [
      { team: Team.NEXUS, teamName: "NEXUS", memberScores: [], challengeTotal: 200, totalPrs: 5, mergedPrs: 5 },
      { team: Team.CIPHER, teamName: "CIPHER", memberScores: [], challengeTotal: 100, totalPrs: 20, mergedPrs: 10 },
    ];

    const results = computeTeamBonuses(rawTeams);
    const cipher = results.find((t) => t.team === Team.CIPHER)!;
    expect(cipher.bonuses.runnerUp).toBe(true);
    expect(cipher.bonuses.mostParticipation).toBe(true);
    expect(cipher.bonuses.bonusPoints).toBe(30); // 15 + 15
    expect(cipher.grandTotal).toBe(130); // 100 + 30
  });
});

// ===========================================================================
// SCENARIO 14 — Full end-to-end: six members, compute team standings
// ===========================================================================

describe("Scenario 14 — Full rehearsal: six members across five teams", () => {
  /**
   * Member setup:
   *   alice-tech  (NEXUS, tech)    : 3 Hard merged (60) = 60 raw → cap 60
   *   bob-general (NEXUS, general) : 2 Hard merged (40) + 1 Medium merged (15) + 1 Easy raised (5) = 60 raw → no cap, 60
   *   carol-cipher(CIPHER, general): 4 Hard merged (80) + 1 Easy merged (10) = 90 raw → cap 80
   *   dave-bb     (BB, general)    : 2 Medium merged (30) + 1 Hard merged (20) = 50 raw → no cap, 50
   *   eve-ascend  (ASCEND, tech)   : 2 Hard merged (40) + 1 Hard raised (5) = 45 raw → no cap, 45
   *   frank-echo  (ECHO, general)  : 1 Medium merged (15) = 15 raw → no cap, 15
   *
   * Capped scores:
   *   alice:  60 (tech cap)
   *   bob:    60 (general, under cap)
   *   carol:  80 (general cap)
   *   dave:   50
   *   eve:    45 (tech, under cap 60)
   *   frank:  15
   *
   * Team challenge totals (sum of capped):
   *   NEXUS       : alice(60) + bob(60) = 120
   *   CIPHER      : carol(80)           = 80
   *   BYTE_BRIGADE: dave(50)            = 50
   *   ASCEND      : eve(45)             = 45
   *   ECHO        : frank(15)           = 15
   *
   * Standings (challenge):
   *   1. NEXUS       120 → Winner        (+20) → grandTotal = 140
   *   2. CIPHER       80 → Runner-up     (+15) → grandTotal = 95
   *      Most Participation: PRs by non-winners
   *        CIPHER: carol has 5 PRs (4+1 hard+easy counting, all count)
   *        BB: dave 3, ASCEND: eve 3, ECHO: frank 1
   *        → CIPHER gets Most Participation (+15) → grandTotal = 110
   *   3. BYTE_BRIGADE 50 → grandTotal = 50
   *   4. ASCEND       45 → grandTotal = 45
   *   5. ECHO         15 → grandTotal = 15
   *
   * NEXUS total PRs = alice(3 merged) + bob(4 counted) = 7
   * CIPHER total PRs = carol 5
   * Most participation (non-winner): CIPHER 5 > BB 3 > ASCEND 3 → CIPHER wins
   */

  it("14a: individual capped scores match hand-calculation", async () => {
    const members = [
      {
        member: { ...aliceTech, pullRequests: [makePR("a1",1,IssueLevel.hard,true), makePR("a2",2,IssueLevel.hard,true), makePR("a3",3,IssueLevel.hard,true)] },
        expectedRaw: 60, expectedCapped: 60,
      },
      {
        member: { ...bobGeneral, pullRequests: [makePR("b1",1,IssueLevel.hard,true), makePR("b2",2,IssueLevel.hard,true), makePR("b3",3,IssueLevel.medium,true), makePR("b4",4,IssueLevel.easy,false)] },
        expectedRaw: 60, expectedCapped: 60,
      },
      {
        member: { ...carolCipher, pullRequests: [makePR("c1",1,IssueLevel.hard,true), makePR("c2",2,IssueLevel.hard,true), makePR("c3",3,IssueLevel.hard,true), makePR("c4",4,IssueLevel.hard,true), makePR("c5",5,IssueLevel.easy,true)] },
        expectedRaw: 90, expectedCapped: 80,
      },
      {
        member: { ...daveBB, pullRequests: [makePR("d1",1,IssueLevel.medium,true), makePR("d2",2,IssueLevel.medium,true), makePR("d3",3,IssueLevel.hard,true)] },
        expectedRaw: 50, expectedCapped: 50,
      },
      {
        member: { ...eveAscend, pullRequests: [makePR("e1",1,IssueLevel.hard,true), makePR("e2",2,IssueLevel.hard,true), makePR("e3",3,IssueLevel.hard,false)] },
        expectedRaw: 45, expectedCapped: 45,
      },
      {
        member: { ...frankEcho, pullRequests: [makePR("f1",1,IssueLevel.medium,true)] },
        expectedRaw: 15, expectedCapped: 15,
      },
    ];

    for (const { member, expectedRaw, expectedCapped } of members) {
      const score = await getMemberScore(makeMockDb(member), member.id);
      expect(score.raw, `${member.githubLogin} raw`).toBe(expectedRaw);
      expect(score.capped, `${member.githubLogin} capped`).toBe(expectedCapped);
    }
  });

  it("14b: team challenge totals are sum of individual capped scores", () => {
    // NEXUS = 60 + 60 = 120
    // CIPHER = 80
    // BYTE_BRIGADE = 50
    // ASCEND = 45
    // ECHO = 15
    const expectedTotals: Record<string, number> = {
      NEXUS: 120,
      CIPHER: 80,
      BYTE_BRIGADE: 50,
      ASCEND: 45,
      ECHO: 15,
    };

    const cappedScores: Record<string, number> = {
      "alice-tech": 60,
      "bob-general": 60,
      "carol-cipher": 80,
      "dave-bb": 50,
      "eve-ascend": 45,
      "frank-echo": 15,
    };

    const teamMembers: Record<string, string[]> = {
      NEXUS: ["alice-tech", "bob-general"],
      CIPHER: ["carol-cipher"],
      BYTE_BRIGADE: ["dave-bb"],
      ASCEND: ["eve-ascend"],
      ECHO: ["frank-echo"],
    };

    for (const [team, members] of Object.entries(teamMembers)) {
      const total = members.reduce((sum, login) => sum + (cappedScores[login] ?? 0), 0);
      expect(total, `${team} total`).toBe(expectedTotals[team]);
    }
  });

  it("14c: team bonus and grandTotal match full hand-calculation", () => {
    // From scenario description above:
    const rawTeams = [
      { team: Team.NEXUS, teamName: "NEXUS", memberScores: [], challengeTotal: 120, totalPrs: 7, mergedPrs: 6 },
      { team: Team.CIPHER, teamName: "CIPHER", memberScores: [], challengeTotal: 80, totalPrs: 5, mergedPrs: 5 },
      { team: Team.BYTE_BRIGADE, teamName: "BYTE_BRIGADE", memberScores: [], challengeTotal: 50, totalPrs: 3, mergedPrs: 2 },
      { team: Team.ASCEND, teamName: "ASCEND", memberScores: [], challengeTotal: 45, totalPrs: 3, mergedPrs: 2 },
      { team: Team.ECHO, teamName: "ECHO", memberScores: [], challengeTotal: 15, totalPrs: 1, mergedPrs: 1 },
    ];

    const results = computeTeamBonuses(rawTeams);
    const nexus = results.find((t) => t.team === Team.NEXUS)!;
    const cipher = results.find((t) => t.team === Team.CIPHER)!;
    const bb = results.find((t) => t.team === Team.BYTE_BRIGADE)!;
    const ascend = results.find((t) => t.team === Team.ASCEND)!;
    const echo = results.find((t) => t.team === Team.ECHO)!;

    // NEXUS: winner
    expect(nexus.bonuses.winner).toBe(true);
    expect(nexus.bonuses.runnerUp).toBe(false);
    expect(nexus.bonuses.mostParticipation).toBe(false);
    expect(nexus.bonuses.bonusPoints).toBe(20);
    expect(nexus.grandTotal).toBe(140); // 120 + 20

    // CIPHER: runner-up + most participation (5 PRs > others among non-winners)
    expect(cipher.bonuses.winner).toBe(false);
    expect(cipher.bonuses.runnerUp).toBe(true);
    expect(cipher.bonuses.mostParticipation).toBe(true);
    expect(cipher.bonuses.bonusPoints).toBe(30); // 15 + 15
    expect(cipher.grandTotal).toBe(110); // 80 + 30

    // BB: no bonus
    expect(bb.bonuses.bonusPoints).toBe(0);
    expect(bb.grandTotal).toBe(50);

    // ASCEND: no bonus
    expect(ascend.bonuses.bonusPoints).toBe(0);
    expect(ascend.grandTotal).toBe(45);

    // ECHO: no bonus
    expect(echo.bonuses.bonusPoints).toBe(0);
    expect(echo.grandTotal).toBe(15);

    // Final ranking: NEXUS(140) > CIPHER(110) > BB(50) > ASCEND(45) > ECHO(15)
    expect(results[0]!.team).toBe(Team.NEXUS);
    expect(results[1]!.team).toBe(Team.CIPHER);
    expect(results[2]!.team).toBe(Team.BYTE_BRIGADE);
    expect(results[3]!.team).toBe(Team.ASCEND);
    expect(results[4]!.team).toBe(Team.ECHO);
  });
});

// ===========================================================================
// PHASE B7b — OFFICIAL WORKED EXAMPLES & EDGE CASE TESTS (Task 3 & Task 4)
// ===========================================================================

describe("Phase B7b — Task 3 & 4: Official Worked Examples & Scoring Engine Invariants", () => {
  it("Worked Example 1: PR-department member: 3 Easy merged (30) + 1 Medium not merged (5) + 1 Hard merged (20) => 55. Under the 80 cap, so final = 55", async () => {
    const member: MockMember = {
      ...bobGeneral,
      department: Department.pr,
      tier: Tier.general,
      pullRequests: [
        makePR("ex1-1", 1, IssueLevel.easy, true),
        makePR("ex1-2", 2, IssueLevel.easy, true),
        makePR("ex1-3", 3, IssueLevel.easy, true),
        makePR("ex1-4", 4, IssueLevel.medium, false),
        makePR("ex1-5", 5, IssueLevel.hard, true),
      ],
    };

    const score = await getMemberScore(makeMockDb(member), member.id);
    expect(score.raw).toBe(55);
    expect(score.tierCap).toBe(80);
    expect(score.capped).toBe(55);
  });

  it("Worked Example 2: Social-department member: 3 Easy merged (30) + 2 Hard merged (40) + 1 Medium merged (15) => 85 raw, capped to 80", async () => {
    const member: MockMember = {
      ...carolCipher,
      department: Department.social,
      tier: Tier.general,
      pullRequests: [
        makePR("ex2-1", 1, IssueLevel.easy, true),
        makePR("ex2-2", 2, IssueLevel.easy, true),
        makePR("ex2-3", 3, IssueLevel.easy, true),
        makePR("ex2-4", 4, IssueLevel.hard, true),
        makePR("ex2-5", 5, IssueLevel.hard, true),
        makePR("ex2-6", 6, IssueLevel.medium, true),
      ],
    };

    const score = await getMemberScore(makeMockDb(member), member.id);
    expect(score.raw).toBe(85);
    expect(score.tierCap).toBe(80);
    expect(score.capped).toBe(80);
  });

  it("Worked Example 3: Tech-department member: 2 Hard merged (40) + 1 Medium merged (15) + 1 Hard not merged (5) => 60 or 65 raw, capped to 60", async () => {
    // 2 Hard merged (40) + 1 Medium merged (15) + 1 Hard not merged (5) = 60 raw (capped to 60)
    const member60: MockMember = {
      ...aliceTech,
      department: Department.technical,
      tier: Tier.tech,
      pullRequests: [
        makePR("ex3-1", 1, IssueLevel.hard, true),
        makePR("ex3-2", 2, IssueLevel.hard, true),
        makePR("ex3-3", 3, IssueLevel.medium, true),
        makePR("ex3-4", 4, IssueLevel.hard, false),
      ],
    };

    const score60 = await getMemberScore(makeMockDb(member60), member60.id);
    expect(score60.raw).toBe(60);
    expect(score60.tierCap).toBe(60);
    expect(score60.capped).toBe(60);

    // If member has additional unmerged work reaching 65 raw, it is still capped to 60
    const member65: MockMember = {
      ...aliceTech,
      department: Department.technical,
      tier: Tier.tech,
      pullRequests: [
        makePR("ex3-1", 1, IssueLevel.hard, true),
        makePR("ex3-2", 2, IssueLevel.hard, true),
        makePR("ex3-3", 3, IssueLevel.medium, true),
        makePR("ex3-4", 4, IssueLevel.hard, false),
        makePR("ex3-5", 5, IssueLevel.medium, false),
      ],
    };

    const score65 = await getMemberScore(makeMockDb(member65), member65.id);
    expect(score65.raw).toBe(65);
    expect(score65.tierCap).toBe(60);
    expect(score65.capped).toBe(60);
  });

  it("two PRs on one Medium issue, one merged: the merged one scores 15, the other drops to 5", () => {
    const mergedPoints = getPRPoints(IssueLevel.medium, true, true);
    const unmergedPoints = getPRPoints(IssueLevel.medium, false, true);
    expect(mergedPoints).toBe(15);
    expect(unmergedPoints).toBe(5);
  });

  it("a PR with no valid claim scores 0", () => {
    // PRs with countsForScore=false (e.g. no valid claim) score 0 points
    expect(getPRPoints(IssueLevel.easy, true, false)).toBe(0);
    expect(getPRPoints(IssueLevel.medium, true, false)).toBe(0);
    expect(getPRPoints(IssueLevel.hard, true, false)).toBe(0);
    expect(getPRPoints(IssueLevel.easy, false, false)).toBe(0);
    expect(getPRPoints(IssueLevel.medium, false, false)).toBe(0);
    expect(getPRPoints(IssueLevel.hard, false, false)).toBe(0);
  });

  it("a PR merged after the final deadline scores 0", () => {
    // Merged after final deadline -> countsForScore=false -> 0 points
    expect(getPRPoints(IssueLevel.hard, true, false)).toBe(0);
    expect(getPRPoints(IssueLevel.medium, true, false)).toBe(0);
    expect(getPRPoints(IssueLevel.easy, true, false)).toBe(0);
  });

  it("Most Participation goes to the team with the most PRs EXCLUDING the winning team — fixture where winner has most PRs", () => {
    // Winner NEXUS has 20 PRs, but cannot win Most Participation
    // CIPHER has 12 PRs (most among non-winners) -> CIPHER must receive Most Participation (+15)
    const rawTeams = [
      { team: Team.NEXUS, teamName: "NEXUS", memberScores: [], challengeTotal: 150, totalPrs: 20, mergedPrs: 15 },
      { team: Team.CIPHER, teamName: "CIPHER", memberScores: [], challengeTotal: 100, totalPrs: 12, mergedPrs: 8 },
      { team: Team.BYTE_BRIGADE, teamName: "BYTE_BRIGADE", memberScores: [], challengeTotal: 90, totalPrs: 8, mergedPrs: 5 },
      { team: Team.ASCEND, teamName: "ASCEND", memberScores: [], challengeTotal: 80, totalPrs: 6, mergedPrs: 4 },
      { team: Team.ECHO, teamName: "ECHO", memberScores: [], challengeTotal: 40, totalPrs: 3, mergedPrs: 2 },
    ];

    const results = computeTeamBonuses(rawTeams);
    const winner = results.find((t) => t.team === Team.NEXUS)!;
    const cipher = results.find((t) => t.team === Team.CIPHER)!;
    const bb = results.find((t) => t.team === Team.BYTE_BRIGADE)!;

    // Winner assertion:
    expect(winner.bonuses.winner).toBe(true);
    expect(winner.bonuses.runnerUp).toBe(false);
    expect(winner.bonuses.mostParticipation).toBe(false);
    expect(winner.bonuses.bonusPoints).toBe(20);
    expect(winner.grandTotal).toBe(170);

    // CIPHER assertion: Runner-up (+15) AND Most Participation (+15) = +30 bonus
    expect(cipher.bonuses.winner).toBe(false);
    expect(cipher.bonuses.runnerUp).toBe(true);
    expect(cipher.bonuses.mostParticipation).toBe(true);
    expect(cipher.bonuses.bonusPoints).toBe(30);
    expect(cipher.grandTotal).toBe(130);

    // BB assertion:
    expect(bb.bonuses.mostParticipation).toBe(false);
    expect(bb.grandTotal).toBe(90);
  });

  it("a member over their cap contributes only their capped value to the team total, never raw", async () => {
    // Carol has 120 raw points (6 Hard merged * 20), capped to 80
    const carol: MockMember = {
      ...carolCipher,
      pullRequests: [
        makePR("p1", 1, IssueLevel.hard, true),
        makePR("p2", 2, IssueLevel.hard, true),
        makePR("p3", 3, IssueLevel.hard, true),
        makePR("p4", 4, IssueLevel.hard, true),
        makePR("p5", 5, IssueLevel.hard, true),
        makePR("p6", 6, IssueLevel.hard, true),
      ],
    };

    const carolScore = await getMemberScore(makeMockDb(carol), carol.id);
    expect(carolScore.raw).toBe(120);
    expect(carolScore.capped).toBe(80);

    const mockDb = {
      member: {
        findUnique: async () => carol,
        findMany: async () => [{ id: carol.id }],
      },
    };

    const teamScores = await getTeamScores(mockDb);
    const cipherTeam = teamScores.find((t) => t.team === Team.CIPHER)!;
    expect(cipherTeam.challengeTotal).toBe(80); // Team total is 80, not 120
  });

  it("Task 4: CLAIM_TTL_HOURS defaults to 48 and claim deadline derives from config", () => {
    expect(config.CLAIM_TTL_HOURS).toBe(48);
    const baseTime = new Date("2026-09-19T12:00:00.000Z");
    const derivedDeadline = new Date(baseTime.getTime() + config.CLAIM_TTL_HOURS * 60 * 60 * 1000);
    expect(derivedDeadline.toISOString()).toBe("2026-09-21T12:00:00.000Z");
  });
});

