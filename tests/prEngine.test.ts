/**
 * prEngine.test.ts — Phase B4
 *
 * Unit tests for PR linking and merge handling in prEngine.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseIssueReferences,
  processPullRequestOpened,
  processPullRequestClosed,
} from "../src/domain/prEngine.js";
import { ClaimStatus, IssueLevel, Tier, Team, Department } from "@prisma/client";

describe("parseIssueReferences", () => {
  it("extracts #<n> with and without keywords case-insensitively", () => {
    const text = "Fixes #12 and closes #34. Also resolves #56 and plain #78. Duplicate #12 should be unique.";
    const refs = parseIssueReferences("PR Title: fixes #99", text);
    const nums = refs.map((r) => r.issueNumber);
    expect(nums).toEqual([99, 12, 34, 56, 78]);
  });

  it("extracts full GitHub issue URLs", () => {
    const body = "This solves https://github.com/AARVAK-VSET/aqua-sense/issues/42 and https://github.com/AARVAK-VSET/aqua-sense/issues/42";
    const refs = parseIssueReferences("Title", body);
    expect(refs).toEqual([
      { repoOwner: "AARVAK-VSET", repoName: "aqua-sense", issueNumber: 42 },
    ]);
  });

  it("handles mixed URLs and hash references without invalid duplicates", () => {
    const title = "Fixes #10";
    const body = "See https://github.com/AARVAK-VSET/aqua-sense/issues/20 and #30";
    const refs = parseIssueReferences(title, body);
    expect(refs).toHaveLength(3);
    expect(refs.map((r) => r.issueNumber)).toContain(10);
    expect(refs.map((r) => r.issueNumber)).toContain(20);
    expect(refs.map((r) => r.issueNumber)).toContain(30);
  });
});

describe("processPullRequestOpened", () => {
  const repoCtx = { owner: "AARVAK-VSET", name: "aqua-sense" };
  const mockMember = {
    id: "mem-1",
    githubUserId: BigInt(100),
    githubLogin: "alice",
    tier: Tier.general,
    team: Team.NEXUS,
    department: Department.pr,
  };

  it("rejects unregistered author and does not score", async () => {
    const mockDb = {
      repo: {
        findFirst: async () => ({ id: "repo-1", owner: "AARVAK-VSET", name: "aqua-sense" }),
      },
      member: {
        findUnique: async () => null,
      },
    };

    const res = await processPullRequestOpened(
      mockDb,
      {
        id: 1001,
        number: 1,
        title: "Fixes #1",
        createdAt: "2026-09-19T10:00:00Z",
        user: { id: 999, login: "stranger" },
      },
      repoCtx
    );

    expect(res.outcome).toBe("not_registered");
    expect(res.countsForScore).toBe(false);
  });

  it("links PR when author holds active claim on referenced issue and frees slot (pr_raised)", async () => {
    let claimStatus = ClaimStatus.active;
    let recordedPr: any = null;
    const commentsPosted: any[] = [];

    const mockDb = {
      repo: {
        findFirst: async () => ({ id: "repo-1", owner: "AARVAK-VSET", name: "aqua-sense" }),
      },
      member: {
        findUnique: async () => mockMember,
      },
      issue: {
        findMany: async () => [
          {
            id: "issue-1",
            number: 5,
            claims: [{ id: "claim-1", memberId: "mem-1", status: claimStatus }],
          },
        ],
      },
      pullRequest: {
        findFirst: async () => recordedPr,
        create: async ({ data }: any) => {
          recordedPr = { id: "pr-1", ...data };
          return recordedPr;
        },
      },
      claim: {
        update: async ({ data }: any) => {
          claimStatus = data.status;
        },
      },
      $transaction: async (fn: any) => fn(mockDb),
    };

    const postReply = async (issueId: string, kind: string, body: string, memberId: string | null) => {
      commentsPosted.push({ issueId, kind, body, memberId });
    };

    const res = await processPullRequestOpened(
      mockDb,
      {
        id: 5001,
        number: 10,
        title: "Fixes #5",
        createdAt: "2026-09-19T10:00:00Z",
        user: { id: 100, login: "alice" },
      },
      repoCtx,
      { postReply }
    );

    expect(res.outcome).toBe("linked");
    expect(res.countsForScore).toBe(true);
    expect(claimStatus).toBe(ClaimStatus.pr_raised);
    expect(recordedPr).toBeDefined();
    expect(recordedPr.countsForScore).toBe(true);
    expect(commentsPosted).toHaveLength(1);
    expect(commentsPosted[0].kind).toBe("pr_linked");
  });

  it("marks countsForScore = false and posts disambiguation comment when multiple active claimed issues referenced", async () => {
    let recordedPr: any = null;
    const commentsPosted: any[] = [];

    const mockDb = {
      repo: {
        findFirst: async () => ({ id: "repo-1", owner: "AARVAK-VSET", name: "aqua-sense" }),
      },
      member: {
        findUnique: async () => mockMember,
      },
      issue: {
        findMany: async () => [
          {
            id: "issue-1",
            number: 1,
            claims: [{ id: "claim-1", memberId: "mem-1", status: ClaimStatus.active }],
          },
          {
            id: "issue-2",
            number: 2,
            claims: [{ id: "claim-2", memberId: "mem-1", status: ClaimStatus.active }],
          },
        ],
      },
      pullRequest: {
        findFirst: async () => recordedPr,
        create: async ({ data }: any) => {
          recordedPr = { id: "pr-1", ...data };
          return recordedPr;
        },
      },
      $transaction: async (fn: any) => fn(mockDb),
    };

    const postReply = async (issueId: string, kind: string, body: string, memberId: string | null) => {
      commentsPosted.push({ issueId, kind, body, memberId });
    };

    const res = await processPullRequestOpened(
      mockDb,
      {
        id: 5002,
        number: 11,
        title: "Fixes #1 and closes #2",
        createdAt: "2026-09-19T10:00:00Z",
        user: { id: 100, login: "alice" },
      },
      repoCtx,
      { postReply }
    );

    expect(res.outcome).toBe("ambiguous_claims");
    expect(res.countsForScore).toBe(false);
    expect(recordedPr.countsForScore).toBe(false);
    expect(commentsPosted[0].kind).toBe("pr_ambiguous_reference");
    expect(commentsPosted[0].body).toContain("Multiple issues (#1, #2)");
  });

  it("marks countsForScore = false when author has no active claim on the issue", async () => {
    let recordedPr: any = null;
    const commentsPosted: any[] = [];

    const mockDb = {
      repo: {
        findFirst: async () => ({ id: "repo-1", owner: "AARVAK-VSET", name: "aqua-sense" }),
      },
      member: {
        findUnique: async () => mockMember,
      },
      issue: {
        findMany: async () => [
          {
            id: "issue-3",
            number: 3,
            claims: [], // no active claim
          },
        ],
      },
      pullRequest: {
        findFirst: async () => recordedPr,
        create: async ({ data }: any) => {
          recordedPr = { id: "pr-1", ...data };
          return recordedPr;
        },
      },
      $transaction: async (fn: any) => fn(mockDb),
    };

    const postReply = async (issueId: string, kind: string, body: string, memberId: string | null) => {
      commentsPosted.push({ issueId, kind, body, memberId });
    };

    const res = await processPullRequestOpened(
      mockDb,
      {
        id: 5003,
        number: 12,
        title: "Fixes #3",
        createdAt: "2026-09-19T10:00:00Z",
        user: { id: 100, login: "alice" },
      },
      repoCtx,
      { postReply }
    );

    expect(res.outcome).toBe("no_valid_claim");
    expect(res.countsForScore).toBe(false);
    expect(recordedPr.countsForScore).toBe(false);
    expect(commentsPosted[0].kind).toBe("pr_unclaimed");
    expect(commentsPosted[0].body).toContain("Per § 2.7");
  });

  it("comments on PR when opened with NO issue reference, guiding author to add Fixes #N", async () => {
    const prCommentsPosted: any[] = [];
    const mockDb = {
      repo: {
        findFirst: async () => ({ id: "repo-1", owner: "AARVAK-VSET", name: "aqua-sense" }),
      },
      member: {
        findUnique: async () => mockMember,
      },
      claim: {
        findMany: async () => [
          {
            id: "claim-1",
            memberId: "mem-1",
            status: ClaimStatus.active,
            issue: { id: "issue-1", number: 7 },
          },
        ],
      },
    };

    const postPrReply = async (owner: string, repo: string, prNumber: number, kind: string, body: string, memberId: string | null) => {
      prCommentsPosted.push({ owner, repo, prNumber, kind, body, memberId });
    };

    const res = await processPullRequestOpened(
      mockDb,
      {
        id: 5004,
        number: 15,
        title: "Initial draft implementation",
        body: "WIP work here",
        createdAt: "2026-09-19T10:00:00Z",
        user: { id: 100, login: "alice" },
      },
      repoCtx,
      { postPrReply }
    );

    expect(res.outcome).toBe("no_issue_referenced");
    expect(res.countsForScore).toBe(false);
    expect(prCommentsPosted).toHaveLength(1);
    expect(prCommentsPosted[0].prNumber).toBe(15);
    expect(prCommentsPosted[0].body).toContain("Fixes #7");
  });

  it("successfully links PR on 'edited' when author adds Fixes #N after initial open", async () => {
    let claimStatus = ClaimStatus.active;
    let recordedPr: any = null;
    const commentsPosted: any[] = [];

    const mockDb = {
      repo: {
        findFirst: async () => ({ id: "repo-1", owner: "AARVAK-VSET", name: "aqua-sense" }),
      },
      member: {
        findUnique: async () => mockMember,
      },
      issue: {
        findMany: async () => [
          {
            id: "issue-9",
            number: 9,
            claims: [{ id: "claim-9", memberId: "mem-1", status: claimStatus }],
          },
        ],
      },
      pullRequest: {
        findFirst: async () => recordedPr,
        create: async ({ data }: any) => {
          recordedPr = { id: "pr-9", ...data };
          return recordedPr;
        },
        update: async ({ data }: any) => {
          recordedPr = { ...recordedPr, ...data };
          return recordedPr;
        },
      },
      claim: {
        update: async ({ data }: any) => {
          claimStatus = data.status;
        },
      },
      $transaction: async (fn: any) => fn(mockDb),
    };

    const postReply = async (issueId: string, kind: string, body: string, memberId: string | null) => {
      commentsPosted.push({ issueId, kind, body, memberId });
    };

    // Simulated "edited" event with title/body now containing "Fixes #9"
    const res = await processPullRequestOpened(
      mockDb,
      {
        id: 5009,
        number: 27,
        title: "Fixes #9 - Add feature",
        body: "Completed implementation",
        createdAt: "2026-09-19T10:00:00Z",
        user: { id: 100, login: "alice" },
      },
      repoCtx,
      { postReply }
    );

    expect(res.outcome).toBe("linked");
    expect(res.countsForScore).toBe(true);
    expect(claimStatus).toBe(ClaimStatus.pr_raised);
    expect(recordedPr).toBeDefined();
    expect(recordedPr.issueId).toBe("issue-9");
    expect(recordedPr.countsForScore).toBe(true);
    expect(commentsPosted[0].kind).toBe("pr_linked");
  });
});

describe("processPullRequestClosed", () => {
  const repoCtx = { owner: "AARVAK-VSET", name: "aqua-sense" };

  it("handles merged PR, sets claim to merged, and demotes other PR on same issue to merged=false", async () => {
    let pr1 = {
      id: "pr-1",
      number: 101,
      repoId: "repo-1",
      memberId: "mem-1",
      issueId: "issue-1",
      countsForScore: true,
      merged: false,
      issue: { number: 1 },
    };
    let otherPrMerged = true;
    let claimStatus = ClaimStatus.pr_raised;
    const commentsPosted: any[] = [];

    const mockDb = {
      repo: {
        findFirst: async () => ({ id: "repo-1", owner: "AARVAK-VSET", name: "aqua-sense" }),
      },
      pullRequest: {
        findFirst: async () => pr1,
        findMany: async () => [],
        update: async ({ data }: any) => {
          pr1 = { ...pr1, ...data };
          return pr1;
        },
        updateMany: async ({ where, data }: any) => {
          if (where.id?.not === "pr-1") {
            otherPrMerged = data.merged;
          }
        },
      },
      claim: {
        updateMany: async ({ data }: any) => {
          claimStatus = data.status;
        },
      },
      $transaction: async (fn: any) => fn(mockDb),
    };

    const postReply = async (issueId: string, kind: string, body: string, memberId: string | null) => {
      commentsPosted.push({ issueId, kind, body, memberId });
    };

    const res = await processPullRequestClosed(
      mockDb,
      {
        id: 7001,
        number: 101,
        title: "Fixes #1",
        createdAt: "2026-09-19T10:00:00Z",
        closedAt: "2026-09-19T12:00:00Z",
        merged: true,
        user: { id: 100, login: "alice" },
      },
      repoCtx,
      { postReply }
    );

    expect(res.outcome).toBe("merged");
    expect(res.countsForScore).toBe(true);
    expect(pr1.merged).toBe(true);
    expect(claimStatus).toBe(ClaimStatus.merged);
    expect(otherPrMerged).toBe(false); // Demoted so only one PR gets merged value
    expect(commentsPosted[0].kind).toBe("pr_merged");
  });

  it("sets countsForScore = false if PR is merged after FINAL_DEADLINE", async () => {
    let pr1 = {
      id: "pr-1",
      number: 102,
      repoId: "repo-1",
      memberId: "mem-1",
      issueId: "issue-1",
      countsForScore: true,
      merged: false,
      issue: { number: 1 },
    };

    const mockDb = {
      repo: {
        findFirst: async () => ({ id: "repo-1", owner: "AARVAK-VSET", name: "aqua-sense" }),
      },
      pullRequest: {
        findFirst: async () => pr1,
        findMany: async () => [],
        update: async ({ data }: any) => {
          pr1 = { ...pr1, ...data };
          return pr1;
        },
        updateMany: async () => {},
      },
      claim: {
        updateMany: async () => {},
      },
      $transaction: async (fn: any) => fn(mockDb),
    };

    const res = await processPullRequestClosed(
      mockDb,
      {
        id: 7002,
        number: 102,
        title: "Fixes #1",
        createdAt: "2026-09-19T10:00:00Z",
        closedAt: "2026-09-25T00:00:00Z", // Past deadline
        merged: true,
        user: { id: 100, login: "alice" },
      },
      repoCtx,
      {
        postReply: async () => {},
        finalDeadline: new Date("2026-09-20T23:59:59Z"),
      }
    );

    expect(res.outcome).toBe("merged");
    expect(res.countsForScore).toBe(false);
    expect(pr1.countsForScore).toBe(false);
  });

  it("handles unmerged closed PR, retaining raised point value", async () => {
    let pr1 = {
      id: "pr-1",
      number: 103,
      repoId: "repo-1",
      memberId: "mem-1",
      issueId: "issue-1",
      countsForScore: true,
      merged: false,
      issue: { number: 1 },
    };

    const mockDb = {
      repo: {
        findFirst: async () => ({ id: "repo-1", owner: "AARVAK-VSET", name: "aqua-sense" }),
      },
      pullRequest: {
        findFirst: async () => pr1,
        update: async ({ data }: any) => {
          pr1 = { ...pr1, ...data };
          return pr1;
        },
      },
    };

    const res = await processPullRequestClosed(
      mockDb,
      {
        id: 7003,
        number: 103,
        title: "Fixes #1",
        createdAt: "2026-09-19T10:00:00Z",
        closedAt: "2026-09-19T15:00:00Z",
        merged: false,
        user: { id: 100, login: "alice" },
      },
      repoCtx,
      { postReply: async () => {} }
    );

    expect(res.outcome).toBe("closed_unmerged");
    expect(res.countsForScore).toBe(true);
    expect(pr1.merged).toBe(false);
  });

  it("updates two PRs with the same number in different repos independently on merge", async () => {
    let prAqua = {
      id: "pr-aqua-30",
      number: 30,
      repoId: "repo-aqua",
      memberId: "mem-1",
      issueId: "issue-aqua-21",
      countsForScore: true,
      merged: false,
      issue: { number: 21 },
    };

    let prCampus = {
      id: "pr-campus-30",
      number: 30,
      repoId: "repo-campus",
      memberId: "mem-1",
      issueId: "issue-campus-24",
      countsForScore: true,
      merged: false,
      issue: { number: 24 },
    };

    const mockDb = {
      repo: {
        findFirst: async ({ where }: any) => {
          if (where.name === "aqua-sense") return { id: "repo-aqua", owner: "AARVAK-VSET", name: "aqua-sense" };
          if (where.name === "campus-flow") return { id: "repo-campus", owner: "AARVAK-VSET", name: "campus-flow" };
          return null;
        },
      },
      pullRequest: {
        findFirst: async ({ where }: any) => {
          if (where.repoId === "repo-aqua" && where.number === 30) return prAqua;
          if (where.repoId === "repo-campus" && where.number === 30) return prCampus;
          return null;
        },
        findMany: async () => [],
        update: async ({ where, data }: any) => {
          if (where.id === "pr-aqua-30") prAqua = { ...prAqua, ...data };
          if (where.id === "pr-campus-30") prCampus = { ...prCampus, ...data };
        },
        updateMany: async () => {},
      },
      claim: {
        updateMany: async () => {},
      },
      $transaction: async (fn: any) => fn(mockDb),
    };

    // Merge aqua-sense PR 30
    await processPullRequestClosed(
      mockDb,
      {
        id: 4584585902,
        number: 30,
        title: "Fixes #21",
        createdAt: "2026-09-20T15:03:35Z",
        closedAt: "2026-09-20T15:59:52Z",
        merged: true,
        user: { id: 100, login: "alice" },
      },
      { owner: "AARVAK-VSET", name: "aqua-sense" },
      { postReply: async () => {} }
    );

    expect(prAqua.merged).toBe(true);
    expect(prCampus.merged).toBe(false); // campus-flow PR 30 unaffected
  });

  it("merging one PR on a 2-spot issue drops the other PR to raised value (5)", async () => {
    let pr30 = {
      id: "pr-30",
      number: 30,
      repoId: "repo-aqua",
      memberId: "mem-1",
      issueId: "issue-21",
      countsForScore: true,
      merged: true,
      closedAt: new Date("2026-09-20T15:59:52Z"),
      issue: { number: 21 },
    };

    let pr24 = {
      id: "pr-24",
      number: 24,
      repoId: "repo-aqua",
      memberId: "mem-2",
      issueId: "issue-21",
      countsForScore: true,
      merged: false,
      closedAt: null as Date | null,
      issue: { number: 21 },
    };

    const mockDb = {
      repo: {
        findFirst: async () => ({ id: "repo-aqua", owner: "AARVAK-VSET", name: "aqua-sense" }),
      },
      pullRequest: {
        findFirst: async ({ where }: any) => {
          if (where.number === 24) return pr24;
          if (where.number === 30) return pr30;
          return null;
        },
        findMany: async ({ where }: any) => {
          if (where.issueId === "issue-21" && where.id?.not === "pr-24") {
            return [pr30];
          }
          return [];
        },
        update: async ({ where, data }: any) => {
          if (where.id === "pr-24") pr24 = { ...pr24, ...data };
          if (where.id === "pr-30") pr30 = { ...pr30, ...data };
        },
        updateMany: async () => {},
      },
      claim: {
        updateMany: async () => {},
      },
      $transaction: async (fn: any) => fn(mockDb),
    };

    // PR 24 merges later at 16:21:02
    const res = await processPullRequestClosed(
      mockDb,
      {
        id: 4582528723,
        number: 24,
        title: "Fixes #21",
        createdAt: "2026-09-20T05:31:07Z",
        closedAt: "2026-09-20T16:21:02Z",
        merged: true,
        user: { id: 200, login: "bob" },
      },
      { owner: "AARVAK-VSET", name: "aqua-sense" },
      { postReply: async () => {} }
    );

    // PR 24 gets merged: false because PR 30 was merged earlier
    expect(pr24.merged).toBe(false);
    expect(pr24.countsForScore).toBe(true);
    expect(pr30.merged).toBe(true);
  });
});
