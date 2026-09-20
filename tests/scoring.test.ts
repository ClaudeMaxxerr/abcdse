/**
 * scoring.test.ts — Phase B4
 *
 * Comprehensive tests for derived scoring engine and leaderboard endpoints.
 * Includes the 3 official worked examples (non-negotiable: 55, 80, 60).
 */

import { describe, it, expect } from "vitest";
import {
  getPRPoints,
  getTierCap,
  getMemberScore,
  getAllMemberScores,
  getTeamScores,
  computeTeamBonuses,
} from "../src/domain/scoring.js";
import { buildApp } from "../src/app.js";
import { Tier, IssueLevel, Department, Team } from "@prisma/client";

describe("Point Calculation Rules (§ 2.3)", () => {
  it("computes correct points for Easy, Medium, Hard in raised vs merged states", () => {
    // Raised (unmerged) PRs: always 5 points if countsForScore = true
    expect(getPRPoints(IssueLevel.easy, false, true)).toBe(5);
    expect(getPRPoints(IssueLevel.medium, false, true)).toBe(5);
    expect(getPRPoints(IssueLevel.hard, false, true)).toBe(5);

    // Merged PRs: 10, 15, 20
    expect(getPRPoints(IssueLevel.easy, true, true)).toBe(10);
    expect(getPRPoints(IssueLevel.medium, true, true)).toBe(15);
    expect(getPRPoints(IssueLevel.hard, true, true)).toBe(20);

    // Invalid PR (countsForScore = false) -> 0 points
    expect(getPRPoints(IssueLevel.easy, false, false)).toBe(0);
    expect(getPRPoints(IssueLevel.hard, true, false)).toBe(0);
  });

  it("returns correct tier caps", () => {
    expect(getTierCap(Tier.tech)).toBe(60);
    expect(getTierCap(Tier.general)).toBe(80);
  });
});

describe("Official Worked Examples (Non-negotiable)", () => {
  it("Worked Example 1: PR dept member scores exactly 55 raw and 55 capped", async () => {
    // 3 Easy merged (3×10=30) + 1 Medium not merged (5) + 1 Hard merged (20) = 55 raw; general cap 80 → 55
    const mockDb = {
      member: {
        findUnique: async () => ({
          id: "mem-pr-1",
          displayName: "Alice PR",
          githubLogin: "alice-pr",
          department: Department.pr,
          team: Team.NEXUS,
          tier: Tier.general,
          pullRequests: [
            { id: "pr-1", number: 1, merged: true, countsForScore: true, issue: { number: 1, level: IssueLevel.easy, repo: { name: "aqua-sense" } } },
            { id: "pr-2", number: 2, merged: true, countsForScore: true, issue: { number: 2, level: IssueLevel.easy, repo: { name: "aqua-sense" } } },
            { id: "pr-3", number: 3, merged: true, countsForScore: true, issue: { number: 3, level: IssueLevel.easy, repo: { name: "aqua-sense" } } },
            { id: "pr-4", number: 4, merged: false, countsForScore: true, issue: { number: 4, level: IssueLevel.medium, repo: { name: "aqua-sense" } } },
            { id: "pr-5", number: 5, merged: true, countsForScore: true, issue: { number: 5, level: IssueLevel.hard, repo: { name: "aqua-sense" } } },
          ],
        }),
      },
    };

    const score = await getMemberScore(mockDb, "mem-pr-1");
    expect(score.raw).toBe(55);
    expect(score.tierCap).toBe(80);
    expect(score.capped).toBe(55);
    expect(score.prBreakdown).toHaveLength(5);
  });

  it("Worked Example 2: Social dept member scores 85 raw and exactly 80 capped", async () => {
    // 3 Easy merged (30) + 2 Hard merged (40) + 1 Medium merged (15) = 85 raw; general cap 80 → 80
    const mockDb = {
      member: {
        findUnique: async () => ({
          id: "mem-soc-1",
          displayName: "Bob Social",
          githubLogin: "bob-soc",
          department: Department.social,
          team: Team.CIPHER,
          tier: Tier.general,
          pullRequests: [
            { id: "pr-1", number: 1, merged: true, countsForScore: true, issue: { number: 1, level: IssueLevel.easy, repo: { name: "aqua-sense" } } },
            { id: "pr-2", number: 2, merged: true, countsForScore: true, issue: { number: 2, level: IssueLevel.easy, repo: { name: "aqua-sense" } } },
            { id: "pr-3", number: 3, merged: true, countsForScore: true, issue: { number: 3, level: IssueLevel.easy, repo: { name: "aqua-sense" } } },
            { id: "pr-4", number: 4, merged: true, countsForScore: true, issue: { number: 4, level: IssueLevel.hard, repo: { name: "aqua-sense" } } },
            { id: "pr-5", number: 5, merged: true, countsForScore: true, issue: { number: 5, level: IssueLevel.hard, repo: { name: "aqua-sense" } } },
            { id: "pr-6", number: 6, merged: true, countsForScore: true, issue: { number: 6, level: IssueLevel.medium, repo: { name: "aqua-sense" } } },
          ],
        }),
      },
    };

    const score = await getMemberScore(mockDb, "mem-soc-1");
    expect(score.raw).toBe(85);
    expect(score.tierCap).toBe(80);
    expect(score.capped).toBe(80);
  });

  it("Worked Example 3: Tech dept member scores exactly 60 raw and 60 capped", async () => {
    // 2 Hard merged (40) + 1 Medium merged (15) + 1 Hard not merged (5) = 60 raw; tech cap 60 → 60
    const mockDb = {
      member: {
        findUnique: async () => ({
          id: "mem-tech-1",
          displayName: "Charlie Tech",
          githubLogin: "charlie-tech",
          department: Department.technical,
          team: Team.BYTE_BRIGADE,
          tier: Tier.tech,
          pullRequests: [
            { id: "pr-1", number: 1, merged: true, countsForScore: true, issue: { number: 1, level: IssueLevel.hard, repo: { name: "aqua-sense" } } },
            { id: "pr-2", number: 2, merged: true, countsForScore: true, issue: { number: 2, level: IssueLevel.hard, repo: { name: "aqua-sense" } } },
            { id: "pr-3", number: 3, merged: true, countsForScore: true, issue: { number: 3, level: IssueLevel.medium, repo: { name: "aqua-sense" } } },
            { id: "pr-4", number: 4, merged: false, countsForScore: true, issue: { number: 4, level: IssueLevel.hard, repo: { name: "aqua-sense" } } },
          ],
        }),
      },
    };

    const score = await getMemberScore(mockDb, "mem-tech-1");
    expect(score.raw).toBe(60);
    expect(score.tierCap).toBe(60);
    expect(score.capped).toBe(60);
  });
});

describe("Team Scoring and Bonus Calculation (§ 2.6)", () => {
  it("applies Winner (+20), Runner-up (+15), and Most Participation (+15 to non-winner)", () => {
    const rawTeams = [
      {
        team: Team.NEXUS,
        teamName: "NEXUS",
        memberScores: [],
        challengeTotal: 150, // Winner (+20)
        totalPrs: 10,
        mergedPrs: 8,
      },
      {
        team: Team.CIPHER,
        teamName: "CIPHER",
        memberScores: [],
        challengeTotal: 120, // Runner-up (+15) AND Most Participation (+15) because it raised 15 PRs!
        totalPrs: 15,
        mergedPrs: 6,
      },
      {
        team: Team.BYTE_BRIGADE,
        teamName: "BYTE_BRIGADE",
        memberScores: [],
        challengeTotal: 90,
        totalPrs: 8,
        mergedPrs: 4,
      },
      {
        team: Team.ASCEND,
        teamName: "ASCEND",
        memberScores: [],
        challengeTotal: 50,
        totalPrs: 5,
        mergedPrs: 2,
      },
      {
        team: Team.ECHO,
        teamName: "ECHO",
        memberScores: [],
        challengeTotal: 20,
        totalPrs: 2,
        mergedPrs: 1,
      },
    ];

    const results = computeTeamBonuses(rawTeams);

    const nexus = results.find((t) => t.team === Team.NEXUS)!;
    expect(nexus.bonuses.winner).toBe(true);
    expect(nexus.bonuses.runnerUp).toBe(false);
    expect(nexus.bonuses.mostParticipation).toBe(false);
    expect(nexus.bonuses.bonusPoints).toBe(20);
    expect(nexus.grandTotal).toBe(170);

    const cipher = results.find((t) => t.team === Team.CIPHER)!;
    expect(cipher.bonuses.winner).toBe(false);
    expect(cipher.bonuses.runnerUp).toBe(true);
    expect(cipher.bonuses.mostParticipation).toBe(true);
    expect(cipher.bonuses.bonusPoints).toBe(30); // 15 + 15
    expect(cipher.grandTotal).toBe(150);

    const byteBrigade = results.find((t) => t.team === Team.BYTE_BRIGADE)!;
    expect(byteBrigade.bonuses.bonusPoints).toBe(0);
    expect(byteBrigade.grandTotal).toBe(90);
  });

  it("breaks ties by merged PRs, then alphabetical team name", () => {
    const rawTeams = [
      {
        team: Team.ECHO,
        teamName: "ECHO",
        memberScores: [],
        challengeTotal: 100,
        totalPrs: 10,
        mergedPrs: 5, // Same points as ASCEND, but fewer merged PRs
      },
      {
        team: Team.ASCEND,
        teamName: "ASCEND",
        memberScores: [],
        challengeTotal: 100,
        totalPrs: 10,
        mergedPrs: 7, // More merged PRs -> Wins tie-break!
      },
      {
        team: Team.BYTE_BRIGADE,
        teamName: "BYTE_BRIGADE",
        memberScores: [],
        challengeTotal: 50,
        totalPrs: 20, // Wins Most Participation
        mergedPrs: 2,
      },
    ];

    const results = computeTeamBonuses(rawTeams);
    expect(results[0].team).toBe(Team.ASCEND);
    expect(results[0].bonuses.winner).toBe(true);
    expect(results[0].grandTotal).toBe(120); // 100 + 20

    expect(results[1].team).toBe(Team.ECHO);
    expect(results[1].bonuses.runnerUp).toBe(true);
    expect(results[1].grandTotal).toBe(115); // 100 + 15

    expect(results[2].team).toBe(Team.BYTE_BRIGADE);
    expect(results[2].bonuses.mostParticipation).toBe(true);
    expect(results[2].grandTotal).toBe(65); // 50 + 15
  });

  it("empty competition (all teams zero score, zero PRs) produces all-zero standings with no bonuses", () => {
    const rawTeams = [
      {
        team: Team.NEXUS,
        teamName: "NEXUS",
        memberScores: [],
        challengeTotal: 0,
        totalPrs: 0,
        mergedPrs: 0,
      },
      {
        team: Team.CIPHER,
        teamName: "CIPHER",
        memberScores: [],
        challengeTotal: 0,
        totalPrs: 0,
        mergedPrs: 0,
      },
      {
        team: Team.BYTE_BRIGADE,
        teamName: "BYTE_BRIGADE",
        memberScores: [],
        challengeTotal: 0,
        totalPrs: 0,
        mergedPrs: 0,
      },
      {
        team: Team.ASCEND,
        teamName: "ASCEND",
        memberScores: [],
        challengeTotal: 0,
        totalPrs: 0,
        mergedPrs: 0,
      },
      {
        team: Team.ECHO,
        teamName: "ECHO",
        memberScores: [],
        challengeTotal: 0,
        totalPrs: 0,
        mergedPrs: 0,
      },
    ];

    const results = computeTeamBonuses(rawTeams);
    expect(results).toHaveLength(5);

    for (const t of results) {
      expect(t.challengeTotal).toBe(0);
      expect(t.totalPrs).toBe(0);
      expect(t.mergedPrs).toBe(0);
      expect(t.bonuses.winner).toBe(false);
      expect(t.bonuses.runnerUp).toBe(false);
      expect(t.bonuses.mostParticipation).toBe(false);
      expect(t.bonuses.bonusPoints).toBe(0);
      expect(t.grandTotal).toBe(0);
    }
  });

  it("single scoring team gets winner bonus only; zero-score teams receive 0 bonuses", () => {
    const rawTeams = [
      {
        team: Team.NEXUS,
        teamName: "NEXUS",
        memberScores: [],
        challengeTotal: 40,
        totalPrs: 3,
        mergedPrs: 2,
      },
      {
        team: Team.CIPHER,
        teamName: "CIPHER",
        memberScores: [],
        challengeTotal: 0,
        totalPrs: 0,
        mergedPrs: 0,
      },
      {
        team: Team.BYTE_BRIGADE,
        teamName: "BYTE_BRIGADE",
        memberScores: [],
        challengeTotal: 0,
        totalPrs: 0,
        mergedPrs: 0,
      },
    ];

    const results = computeTeamBonuses(rawTeams);
    const nexus = results.find((t) => t.team === Team.NEXUS)!;
    expect(nexus.bonuses.winner).toBe(true);
    expect(nexus.bonuses.runnerUp).toBe(false);
    expect(nexus.bonuses.mostParticipation).toBe(false);
    expect(nexus.bonuses.bonusPoints).toBe(20);
    expect(nexus.grandTotal).toBe(60);

    const cipher = results.find((t) => t.team === Team.CIPHER)!;
    expect(cipher.bonuses.winner).toBe(false);
    expect(cipher.bonuses.runnerUp).toBe(false);
    expect(cipher.bonuses.mostParticipation).toBe(false);
    expect(cipher.bonuses.bonusPoints).toBe(0);
    expect(cipher.grandTotal).toBe(0);

    const bb = results.find((t) => t.team === Team.BYTE_BRIGADE)!;
    expect(bb.bonuses.winner).toBe(false);
    expect(bb.bonuses.runnerUp).toBe(false);
    expect(bb.bonuses.mostParticipation).toBe(false);
    expect(bb.bonuses.bonusPoints).toBe(0);
    expect(bb.grandTotal).toBe(0);
  });

  it("gating on FINAL_DEADLINE: before deadline, bonusPoints is 0 for every team and grandTotal equals challengeTotal", () => {
    const rawTeams = [
      { team: Team.BYTE_BRIGADE, teamName: "BYTE_BRIGADE", memberScores: [], challengeTotal: 30, totalPrs: 5, mergedPrs: 3 },
      { team: Team.ASCEND, teamName: "ASCEND", memberScores: [], challengeTotal: 10, totalPrs: 6, mergedPrs: 1 },
      { team: Team.CIPHER, teamName: "CIPHER", memberScores: [], challengeTotal: 0, totalPrs: 0, mergedPrs: 0 },
      { team: Team.ECHO, teamName: "ECHO", memberScores: [], challengeTotal: 0, totalPrs: 0, mergedPrs: 0 },
      { team: Team.NEXUS, teamName: "NEXUS", memberScores: [], challengeTotal: 0, totalPrs: 0, mergedPrs: 0 },
    ];

    const now = new Date("2026-09-20T12:00:00.000Z");
    const finalDeadline = new Date("2026-09-21T12:00:00.000Z"); // in future

    const results = computeTeamBonuses(rawTeams, { now, finalDeadline });

    for (const team of results) {
      expect(team.bonuses.winner).toBe(false);
      expect(team.bonuses.runnerUp).toBe(false);
      expect(team.bonuses.mostParticipation).toBe(false);
      expect(team.bonuses.bonusPoints).toBe(0);
      expect(team.bonuses.totalBonus).toBe(0);
      expect(team.grandTotal).toBe(team.challengeTotal);
    }

    // BYTE_BRIGADE is top on challengeTotal (30), grandTotal is 30 (not 50)
    expect(results[0].team).toBe(Team.BYTE_BRIGADE);
    expect(results[0].grandTotal).toBe(30);

    // ASCEND is second on challengeTotal (10), grandTotal is 10 (not 40)
    expect(results[1].team).toBe(Team.ASCEND);
    expect(results[1].grandTotal).toBe(10);
  });

  it("gating on FINAL_DEADLINE: after deadline, bonuses apply (+20 winner, +15 runner-up, +15 most participation)", () => {
    const rawTeams = [
      { team: Team.BYTE_BRIGADE, teamName: "BYTE_BRIGADE", memberScores: [], challengeTotal: 30, totalPrs: 5, mergedPrs: 3 },
      { team: Team.ASCEND, teamName: "ASCEND", memberScores: [], challengeTotal: 10, totalPrs: 6, mergedPrs: 1 },
      { team: Team.CIPHER, teamName: "CIPHER", memberScores: [], challengeTotal: 0, totalPrs: 0, mergedPrs: 0 },
      { team: Team.ECHO, teamName: "ECHO", memberScores: [], challengeTotal: 0, totalPrs: 0, mergedPrs: 0 },
      { team: Team.NEXUS, teamName: "NEXUS", memberScores: [], challengeTotal: 0, totalPrs: 0, mergedPrs: 0 },
    ];

    const now = new Date("2026-09-22T12:00:00.000Z");
    const finalDeadline = new Date("2026-09-21T12:00:00.000Z"); // in past

    const results = computeTeamBonuses(rawTeams, { now, finalDeadline });

    const bb = results.find((t) => t.team === Team.BYTE_BRIGADE)!;
    expect(bb.bonuses.winner).toBe(true);
    expect(bb.bonuses.runnerUp).toBe(false);
    expect(bb.bonuses.mostParticipation).toBe(false);
    expect(bb.bonuses.bonusPoints).toBe(20);
    expect(bb.grandTotal).toBe(50); // 30 + 20

    const ascend = results.find((t) => t.team === Team.ASCEND)!;
    expect(ascend.bonuses.winner).toBe(false);
    expect(ascend.bonuses.runnerUp).toBe(true);
    expect(ascend.bonuses.mostParticipation).toBe(true);
    expect(ascend.bonuses.bonusPoints).toBe(30); // 15 + 15
    expect(ascend.grandTotal).toBe(40); // 10 + 30
  });

  it("gating with freezeStandings toggle: applies bonuses even if now < finalDeadline", () => {
    const rawTeams = [
      { team: Team.BYTE_BRIGADE, teamName: "BYTE_BRIGADE", memberScores: [], challengeTotal: 30, totalPrs: 5, mergedPrs: 3 },
      { team: Team.ASCEND, teamName: "ASCEND", memberScores: [], challengeTotal: 10, totalPrs: 6, mergedPrs: 1 },
    ];

    const now = new Date("2026-09-20T12:00:00.000Z");
    const finalDeadline = new Date("2026-09-25T12:00:00.000Z"); // far in future

    const results = computeTeamBonuses(rawTeams, { now, finalDeadline, freezeStandings: true });

    const bb = results.find((t) => t.team === Team.BYTE_BRIGADE)!;
    expect(bb.bonuses.winner).toBe(true);
    expect(bb.bonuses.bonusPoints).toBe(20);
    expect(bb.grandTotal).toBe(50);
  });
});

describe("API Endpoints — Leaderboard and Member Breakdown", () => {
  it("GET /api/leaderboard/teams returns isEventOver and deferred bonuses while live", async () => {
    const mockDb = {
      member: {
        findMany: async () => [
          {
            id: "mem-bb",
            displayName: "Dave BB",
            githubLogin: "dave-bb",
            department: Department.technical,
            team: Team.BYTE_BRIGADE,
            tier: Tier.tech,
            pullRequests: [
              { id: "pr-1", number: 1, merged: true, countsForScore: true, issue: { number: 1, level: IssueLevel.hard, repo: { name: "aqua-sense" } } },
              { id: "pr-2", number: 2, merged: false, countsForScore: true, issue: { number: 2, level: IssueLevel.hard, repo: { name: "aqua-sense" } } },
            ],
          },
        ],
      },
      systemConfig: {
        findMany: async () => [
          { key: "final_deadline", value: new Date(Date.now() + 86400000).toISOString() },
          { key: "freeze_standings", value: "false" },
        ],
      },
      $queryRaw: async () => [{ 1: 1 }],
    } as any;

    const app = await buildApp({ prismaClient: mockDb, disableLogging: true });

    const res = await app.inject({
      method: "GET",
      url: "/api/leaderboard/teams",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.isEventOver).toBe(false);
    expect(body.teams).toBeDefined();

    const bb = body.teams.find((t: any) => t.team === Team.BYTE_BRIGADE);
    expect(bb.challengeTotal).toBe(25); // 20 + 5
    expect(bb.bonuses.totalBonus).toBe(0);
    expect(bb.grandTotal).toBe(25); // Equals challengeTotal while live!
  });

  it("GET /api/members/:id/breakdown reconciles: PRs sum to raw, raw caps to final", async () => {
    const mockDb = {
      member: {
        findUnique: async () => ({
          id: "mem-test-1",
          displayName: "Dan Tester",
          githubLogin: "dantest",
          department: Department.technical,
          team: Team.NEXUS,
          tier: Tier.tech,
          pullRequests: [
            { id: "pr-1", number: 1, merged: true, countsForScore: true, issue: { number: 1, level: IssueLevel.hard, repo: { name: "aqua-sense" } } }, // 20
            { id: "pr-2", number: 2, merged: true, countsForScore: true, issue: { number: 2, level: IssueLevel.hard, repo: { name: "aqua-sense" } } }, // 20
            { id: "pr-3", number: 3, merged: true, countsForScore: true, issue: { number: 3, level: IssueLevel.hard, repo: { name: "aqua-sense" } } }, // 20
            { id: "pr-4", number: 4, merged: true, countsForScore: true, issue: { number: 4, level: IssueLevel.medium, repo: { name: "aqua-sense" } } }, // 15
          ],
        }),
      },
      $queryRaw: async () => [{ 1: 1 }],
    } as any;

    const app = await buildApp({ prismaClient: mockDb, disableLogging: true });

    const res = await app.inject({
      method: "GET",
      url: "/api/members/mem-test-1/breakdown",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const m = body.member;

    expect(m.prBreakdown).toHaveLength(4);
    const sumPoints = m.prBreakdown.reduce((acc: number, item: any) => acc + item.points, 0);
    expect(sumPoints).toBe(75);
    expect(m.raw).toBe(75);
    expect(m.tierCap).toBe(60);
    expect(m.capped).toBe(60); // Capped at 60 for tech tier
  });
});
