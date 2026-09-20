/**
 * prReconciliation.test.ts
 *
 * Tests for PR reconciliation engine.
 */

import { describe, it, expect, vi } from "vitest";
import { runPrReconciliation } from "../src/domain/prReconciliation.js";
import { ClaimStatus, Tier, Team, Department } from "@prisma/client";

describe("runPrReconciliation", () => {
  const mockMember = {
    id: "mem-1",
    githubUserId: BigInt(100),
    githubLogin: "alice",
    tier: Tier.general,
    team: Team.NEXUS,
    department: Department.pr,
  };

  const mockMember2 = {
    id: "mem-2",
    githubUserId: BigInt(200),
    githubLogin: "bob",
    tier: Tier.general,
    team: Team.NEXUS,
    department: Department.pr,
  };

  it("reconciles and links an unrecorded open PR that matches an active claim", async () => {
    let recordedPr: any = null;
    let claimStatus = ClaimStatus.active;
    const commentsPosted: any[] = [];
    const prCommentsPosted: any[] = [];

    const mockDb = {
      repo: {
        findMany: async () => [{ id: "repo-1", owner: "AARVAK-VSET", name: "campus-flow" }],
        findFirst: async () => ({ id: "repo-1", owner: "AARVAK-VSET", name: "campus-flow" }),
      },
      member: {
        findUnique: async () => mockMember,
      },
      issue: {
        findMany: async () => [
          {
            id: "issue-19",
            number: 19,
            claims: [{ id: "claim-19", memberId: "mem-1", status: claimStatus }],
          },
        ],
      },
      pullRequest: {
        findFirst: async () => recordedPr,
        create: async ({ data }: any) => {
          recordedPr = { id: "pr-27", ...data };
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

    const mockGithubClient = {
      listPullRequests: async () => [
        {
          id: 99927,
          number: 27,
          title: "Fix campus flow navigation",
          body: "Fixes #19 - resolves student flow sync",
          state: "open",
          created_at: "2026-09-20T11:19:34Z",
          user: { id: 100, login: "alice" },
        },
      ],
    } as any;

    const result = await runPrReconciliation(mockDb, {
      githubClient: mockGithubClient,
      postReply: async (issueId, kind, body, memberId) => {
        commentsPosted.push({ issueId, kind, body, memberId });
      },
      postPrReply: async (owner, repo, prNumber, kind, body, memberId) => {
        prCommentsPosted.push({ owner, repo, prNumber, kind, body, memberId });
      },
    });

    expect(result.recoveredCount).toBe(1);
    expect(result.totalOpenPrs).toBe(1);
    expect(result.reconciledPrs).toHaveLength(1);
    expect(result.reconciledPrs[0].prNumber).toBe(27);
    expect(claimStatus).toBe(ClaimStatus.pr_raised);
    expect(recordedPr).toBeDefined();
    expect(recordedPr.countsForScore).toBe(true);
    expect(recordedPr.issueId).toBe("issue-19");
  });

  it("corrects a merged PR whose closed webhook was never received", async () => {
    let pr30 = {
      id: "pr-30",
      repoId: "repo-aqua",
      number: 30,
      githubPrId: BigInt(12345),
      countsForScore: true,
      merged: false,
      closedAt: null as Date | null,
      issueId: "issue-21",
      memberId: "mem-1",
      repo: { id: "repo-aqua", owner: "AARVAK-VSET", name: "aqua-sense" },
      member: mockMember,
    };

    let claimStatus = ClaimStatus.pr_raised;

    const mockDb = {
      repo: {
        findMany: async () => [{ id: "repo-aqua", owner: "AARVAK-VSET", name: "aqua-sense" }],
      },
      pullRequest: {
        findFirst: async () => pr30,
        update: async ({ data }: any) => {
          pr30 = { ...pr30, ...data };
          return pr30;
        },
      },
      issue: {
        findMany: async () => [
          {
            id: "issue-21",
            number: 21,
            repo: { owner: "AARVAK-VSET", name: "aqua-sense" },
            pullRequests: [pr30],
            claims: [{ id: "claim-21", memberId: "mem-1", status: claimStatus }],
          },
        ],
      },
      claim: {
        updateMany: async ({ data }: any) => {
          claimStatus = data.status;
        },
      },
    };

    const mockGithubClient = {
      listPullRequests: async () => [
        {
          id: 4584585902,
          number: 30,
          title: "Telemetry sync",
          body: "Fixes #21",
          state: "closed",
          merged_at: "2026-09-20T15:59:52Z",
          closed_at: "2026-09-20T15:59:52Z",
          created_at: "2026-09-20T15:03:35Z",
          user: { id: 100, login: "alice" },
        },
      ],
    } as any;

    const result = await runPrReconciliation(mockDb, {
      githubClient: mockGithubClient,
    });

    expect(result.updatedMergeCount).toBe(1);
    expect(pr30.merged).toBe(true);
    expect(pr30.githubPrId).toBe(BigInt(4584585902));
    expect(claimStatus).toBe(ClaimStatus.merged);
  });

  it("reconciles multi-PR issue by awarding merged status to earliest merged PR and demoting later ones", async () => {
    let pr30 = {
      id: "pr-30",
      repoId: "repo-aqua",
      number: 30,
      githubPrId: BigInt(4584585902),
      countsForScore: true,
      merged: false, // mistakenly false
      closedAt: new Date("2026-09-20T15:59:52Z"),
      issueId: "issue-21",
      memberId: "mem-1",
      repo: { id: "repo-aqua", owner: "AARVAK-VSET", name: "aqua-sense" },
      member: mockMember,
    };

    let pr24 = {
      id: "pr-24",
      repoId: "repo-aqua",
      number: 24,
      githubPrId: BigInt(4582528723),
      countsForScore: true,
      merged: true, // mistakenly true
      closedAt: new Date("2026-09-20T16:21:02Z"),
      issueId: "issue-21",
      memberId: "mem-2",
      repo: { id: "repo-aqua", owner: "AARVAK-VSET", name: "aqua-sense" },
      member: mockMember2,
    };

    let claim30Status = ClaimStatus.pr_raised;
    let claim24Status = ClaimStatus.merged;

    const mockDb = {
      repo: {
        findMany: async () => [{ id: "repo-aqua", owner: "AARVAK-VSET", name: "aqua-sense" }],
      },
      pullRequest: {
        findFirst: async ({ where }: any) => {
          if (where.number === 30) return pr30;
          if (where.number === 24) return pr24;
          return null;
        },
        update: async ({ where, data }: any) => {
          if (where.id === "pr-30") pr30 = { ...pr30, ...data };
          if (where.id === "pr-24") pr24 = { ...pr24, ...data };
        },
      },
      issue: {
        findMany: async () => [
          {
            id: "issue-21",
            number: 21,
            repo: { owner: "AARVAK-VSET", name: "aqua-sense" },
            pullRequests: [pr30, pr24],
            claims: [
              { id: "claim-30", memberId: "mem-1", status: claim30Status },
              { id: "claim-24", memberId: "mem-2", status: claim24Status },
            ],
          },
        ],
      },
      claim: {
        updateMany: async ({ where, data }: any) => {
          if (where.memberId === "mem-1") claim30Status = data.status;
          if (where.memberId === "mem-2") claim24Status = data.status;
        },
      },
    };

    const mockGithubClient = {
      listPullRequests: async () => [
        {
          id: 4584585902,
          number: 30,
          title: "Telemetry sync",
          body: "Fixes #21",
          state: "closed",
          merged_at: "2026-09-20T15:59:52Z",
          closed_at: "2026-09-20T15:59:52Z",
          created_at: "2026-09-20T15:03:35Z",
          user: { id: 100, login: "alice" },
        },
        {
          id: 4582528723,
          number: 24,
          title: "Telemetry fix",
          body: "Fixes #21",
          state: "closed",
          merged_at: "2026-09-20T16:21:02Z",
          closed_at: "2026-09-20T16:21:02Z",
          created_at: "2026-09-20T05:31:07Z",
          user: { id: 200, login: "bob" },
        },
      ],
    } as any;

    const result = await runPrReconciliation(mockDb, {
      githubClient: mockGithubClient,
    });

    expect(result.updatedMergeCount).toBe(2);
    expect(pr30.merged).toBe(true);
    expect(pr24.merged).toBe(false);
    expect(claim30Status).toBe(ClaimStatus.merged);

    // Running reconciliation a second time changes nothing
    const secondResult = await runPrReconciliation(mockDb, {
      githubClient: mockGithubClient,
    });
    expect(secondResult.recoveredCount).toBe(0);
    expect(secondResult.updatedMergeCount).toBe(0);
    expect(secondResult.changedRows).toHaveLength(0);
  });
});
