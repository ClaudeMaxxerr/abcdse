/**
 * leaderboard.ts — Phase B4
 *
 * Read-only, rate-limited public leaderboard endpoints.
 * Never exposes emails or session tokens (CONTEXT.md § 9.8).
 */

import { FastifyPluginAsync } from "fastify";
import { prisma } from "../db.js";
import { getTeamScores, getAllMemberScores, getMemberScore } from "../domain/scoring.js";

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
    const teams = await getTeamScores(db);
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
};
