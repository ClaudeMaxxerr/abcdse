/**
 * leaderboard.ts — Phase B4
 *
 * Read-only, rate-limited public leaderboard endpoints.
 * Never exposes emails or session tokens (CONTEXT.md § 9.8).
 */

import { FastifyPluginAsync } from "fastify";
import { prisma } from "../db.js";
import { getTeamScores, getAllMemberScores, getMemberScore, getPRPoints, getTierCap, computePotentialPoints } from "../domain/scoring.js";
import { config } from "../config.js";
import { resolveSession } from "../auth/session.js";
import { readSessionToken } from "../auth/requestHelpers.js";
import { Team, IssueLevel } from "@prisma/client";
import { getTeamDisplayName } from "../domain/teams.js";
import { ACTIVE_CLAIM_STATUSES } from "../domain/claimConstants.js";

export interface LeaderboardRoutesOptions {
  prismaClient?: typeof prisma;
}

export const leaderboardRoutes: FastifyPluginAsync<LeaderboardRoutesOptions> = async (app, opts) => {
  const db = opts.prismaClient ?? prisma;

  // Rate limit: 60 req/min per IP
  const rateLimitConfig = {
    config: {
      rateLimit: {
        max: 60,
        timeWindow: "1 minute",
      },
    },
  };

  /**
   * GET /api/leaderboard/teams
   * Team standings with challenge scores, bonuses, and grand totals.
   */
  app.get("/leaderboard/teams", rateLimitConfig, async (_request, reply) => {
    let finalDeadline: Date | null = config.FINAL_DEADLINE ?? null;
    let freezeStandings = false;

    if (db?.systemConfig?.findMany) {
      try {
        const configs = await db.systemConfig.findMany({
          where: { key: { in: ["final_deadline", "freeze_standings"] } },
        });
        const map = Object.fromEntries(configs.map((c: any) => [c.key, c.value]));
        if (map["final_deadline"]) {
          finalDeadline = new Date(map["final_deadline"]);
        }
        if (map["freeze_standings"] === "true") {
          freezeStandings = true;
        }
      } catch {
        // ignore in mock/test DBs
      }
    }

    const isEventOver = freezeStandings || (finalDeadline !== null && Date.now() >= finalDeadline.getTime());

    const teams = await getTeamScores(db, {
      finalDeadline,
      freezeStandings,
      applyBonuses: isEventOver,
    });

    // Sanitize member scores in teams to exclude sensitive data
    const sanitized = teams.map((team) => ({
      team: team.team,
      teamName: team.teamName,
      challengeTotal: team.challengeTotal,
      totalPrs: team.totalPrs,
      mergedPrs: team.mergedPrs,
      bonuses: team.bonuses,
      grandTotal: team.grandTotal,
      members: team.memberScores.map((m) => ({
        memberId: m.memberId,
        displayName: m.displayName,
        githubLogin: m.githubLogin,
        department: m.department,
        team: m.team,
        tier: m.tier,
        raw: m.raw,
        tierCap: m.tierCap,
        capped: m.capped,
        totalPrs: m.totalPrs,
        mergedPrs: m.mergedPrs,
      })),
    }));

    return reply.status(200).send({
      statusCode: 200,
      teams: sanitized,
      isEventOver,
      finalDeadline: finalDeadline ? finalDeadline.toISOString() : null,
    });
  });

  /**
   * GET /api/leaderboard/members
   * Individual member standings sorted by capped score descending.
   */
  app.get("/leaderboard/members", rateLimitConfig, async (_request, reply) => {
    const members = await getAllMemberScores(db);
    const sanitized = members.map((m) => ({
      memberId: m.memberId,
      displayName: m.displayName,
      githubLogin: m.githubLogin,
      department: m.department,
      team: m.team,
      tier: m.tier,
      raw: m.raw,
      tierCap: m.tierCap,
      capped: m.capped,
      totalPrs: m.totalPrs,
      mergedPrs: m.mergedPrs,
    }));

    return reply.status(200).send({
      statusCode: 200,
      members: sanitized,
    });
  });

  /**
   * GET /api/members/:id/breakdown
   * Detailed PR breakdown for a specific member.
   * Listed PRs sum to raw; raw caps to final.
   */
  app.get<{ Params: { id: string } }>(
    "/members/:id/breakdown",
    rateLimitConfig,
    async (request, reply) => {
      const { id } = request.params;
      try {
        const score = await getMemberScore(db, id);
        return reply.status(200).send({
          statusCode: 200,
          member: {
            memberId: score.memberId,
            displayName: score.displayName,
            githubLogin: score.githubLogin,
            department: score.department,
            team: score.team,
            tier: score.tier,
            raw: score.raw,
            tierCap: score.tierCap,
            capped: score.capped,
            totalPrs: score.totalPrs,
            mergedPrs: score.mergedPrs,
            prBreakdown: score.prBreakdown,
          },
        });
      } catch (err: unknown) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: err instanceof Error ? err.message : `Member ${id} not found`,
        });
      }
    }
  );

  /**
   * GET /api/teams/:team/detail
   * Team detail view (requires login, open to any logged in member).
   */
  app.get<{ Params: { team: string } }>(
    "/teams/:team/detail",
    rateLimitConfig,
    async (request, reply) => {
      const rawToken = readSessionToken(request);
      const session = await resolveSession(db, rawToken);
      if (!session) {
        return reply.status(401).send({
          statusCode: 401,
          error: "Unauthorized",
          message: "Authentication required to view team details",
        });
      }

      const { team: rawTeam } = request.params;
      const teamKey = Object.values(Team).find(
        (t) => t.toLowerCase() === rawTeam.toLowerCase() || t === rawTeam.toUpperCase()
      );

      if (!teamKey) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: `Team '${rawTeam}' not found`,
        });
      }

      const teamMembers = await db.member.findMany({
        where: { team: teamKey },
        include: {
          claims: {
            where: {
              status: { in: [...ACTIVE_CLAIM_STATUSES] },
            },
            include: {
              issue: {
                include: {
                  repo: { select: { owner: true, name: true } },
                },
              },
            },
            orderBy: { claimedAt: "asc" },
          },
          pullRequests: {
            where: {
              countsForScore: true,
            },
            include: {
              issue: {
                include: {
                  repo: { select: { owner: true, name: true } },
                },
              },
            },
            orderBy: { openedAt: "asc" },
          },
        },
      });

      // Rollups by level
      const rollup = {
        activeClaims: { easy: 0, medium: 0, hard: 0, total: 0 },
        prs: { easy: 0, medium: 0, hard: 0, total: 0 },
        mergedPrs: { easy: 0, medium: 0, hard: 0, total: 0 },
      };

      const membersDetail = teamMembers.map((m) => {
        const tierCap = getTierCap(m.tier);
        const memberPrs = m.pullRequests.map((pr) => {
          const level = pr.issue?.level ?? IssueLevel.easy;
          const points = getPRPoints(level, pr.merged, pr.countsForScore);

          // Update rollup PRs
          rollup.prs[level] = (rollup.prs[level] || 0) + 1;
          rollup.prs.total += 1;
          if (pr.merged) {
            rollup.mergedPrs[level] = (rollup.mergedPrs[level] || 0) + 1;
            rollup.mergedPrs.total += 1;
          }

          return {
            id: pr.id,
            prNumber: pr.number,
            repo: pr.issue?.repo?.name ?? "unknown",
            repoName: pr.issue?.repo?.name ?? "unknown",
            issueNumber: pr.issue?.number ?? 0,
            linkedIssueNumber: pr.issue?.number ?? 0,
            issueTitle: pr.issue?.title ?? "",
            title: pr.issue?.title ?? "",
            level,
            points,
            currentValue: points,
            merged: pr.merged,
            countsForScore: pr.countsForScore,
            openedAt: pr.openedAt.toISOString(),
          };
        });

        const raw = memberPrs.reduce((sum, p) => sum + p.points, 0);
        const capped = Math.min(raw, tierCap);
        const potentialPoints = computePotentialPoints(m.pullRequests);
        const totalPrs = memberPrs.length;
        const mergedPrs = memberPrs.filter((p) => p.merged).length;

        const activeClaims = m.claims.map((c) => {
          const level = c.issue.level;
          rollup.activeClaims[level] = (rollup.activeClaims[level] || 0) + 1;
          rollup.activeClaims.total += 1;

          return {
            id: c.id,
            issueId: c.issueId,
            repo: c.issue.repo.name,
            repoOwner: c.issue.repo.owner,
            repoName: c.issue.repo.name,
            issueNumber: c.issue.number,
            issueTitle: c.issue.title,
            title: c.issue.title,
            level,
            claimedAt: c.claimedAt.toISOString(),
            deadline: c.deadline.toISOString(),
          };
        });

        return {
          member: {
            id: m.id,
            displayName: m.displayName,
            githubLogin: m.githubLogin,
            department: m.department,
            tier: m.tier,
            tierCap,
            cap: tierCap,
          },
          raw,
          capped,
          potentialPoints,
          totalPrs,
          mergedPrs,
          activeClaims,
          prs: memberPrs,
        };
      });

      // Sort members within a team by capped points descending
      membersDetail.sort((a, b) => {
        if (b.capped !== a.capped) return b.capped - a.capped;
        if (b.raw !== a.raw) return b.raw - a.raw;
        if (b.mergedPrs !== a.mergedPrs) return b.mergedPrs - a.mergedPrs;
        return a.member.githubLogin.localeCompare(b.member.githubLogin);
      });

      const challengeTotal = membersDetail.reduce((sum, m) => sum + m.capped, 0);
      const totalPrs = membersDetail.reduce((sum, m) => sum + m.totalPrs, 0);
      const mergedPrs = membersDetail.reduce((sum, m) => sum + m.mergedPrs, 0);

      return reply.status(200).send({
        statusCode: 200,
        team: teamKey,
        teamName: getTeamDisplayName(teamKey),
        challengeTotal,
        totalPrs,
        mergedPrs,
        rollup,
        members: membersDetail,
      });
    }
  );
};
