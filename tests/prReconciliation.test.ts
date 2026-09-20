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
      listOpenPullRequests: async () => [
        {
          id: 99927,
          number: 27,
          title: "Fix campus flow navigation",
          body: "Fixes #19 - resolves student flow sync",
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

  it("is idempotent when run multiple times on already recorded PRs", async () => {
    const existingPr = {
      id: "pr-27",
      repoId: "repo-1",
      number: 27,
      countsForScore: true,
      issueId: "issue-19",
      memberId: "mem-1",
      issue: {
        claims: [{ id: "claim-19", memberId: "mem-1", status: ClaimStatus.pr_raised }],
      },
    };

    const mockDb = {
      repo: {
        findMany: async () => [{ id: "repo-1", owner: "AARVAK-VSET", name: "campus-flow" }],
      },
      pullRequest: {
        findFirst: async () => existingPr,
      },
    };

    const mockGithubClient = {
      listOpenPullRequests: async () => [
        {
          id: 99927,
          number: 27,
          title: "Fix campus flow navigation",
          body: "Fixes #19",
          created_at: "2026-09-20T11:19:34Z",
          user: { id: 100, login: "alice" },
        },
      ],
    } as any;

    const result = await runPrReconciliation(mockDb, {
      githubClient: mockGithubClient,
    });

    expect(result.recoveredCount).toBe(0);
    expect(result.totalOpenPrs).toBe(1);
  });
});
