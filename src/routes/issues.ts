/**
 * issues.ts — Phase B6
 *
 * Public issue board API endpoint.
 * Returns all 150 issues with repo info, level, spots taken/total,
 * claimant details, deadline countdown info, waitlist counts, and availability.
 * Read-only, rate-limited per CONTEXT.md § 9.8.
 */

import { FastifyPluginAsync } from "fastify";
import { prisma } from "../db.js";

export interface IssuesRoutesOptions {
  prismaClient?: typeof prisma;
}

export const issuesRoutes: FastifyPluginAsync<IssuesRoutesOptions> = async (app, opts) => {
  const db = opts.prismaClient ?? prisma;

  // Rate limit: 60 req/min
  const rateLimitConfig = {
    config: {
      rateLimit: {
        max: 60,
        timeWindow: "1 minute",
      },
    },
  };

  /**
   * GET /api/issues
   * Returns all 150 seeded issues with real-time claim and waitlist status.
   */
  app.get("/issues", rateLimitConfig, async (_request, reply) => {
    const issues = await db.issue.findMany({
      include: {
        repo: {
          select: {
            owner: true,
            name: true,
          },
        },
        claims: {
          where: {
            status: { in: ["active", "pr_raised"] },
          },
          include: {
            member: {
              select: {
                id: true,
                githubLogin: true,
                displayName: true,
                team: true,
                department: true,
                tier: true,
              },
            },
          },
          orderBy: { claimedAt: "asc" },
        },
        waitlistEntries: {
          where: {
            resolvedAt: null,
          },
          select: {
            id: true,
            position: true,
            queuedAt: true,
            member: {
              select: {
                id: true,
                githubLogin: true,
                displayName: true,
                team: true,
              },
            },
          },
          orderBy: { position: "asc" },
        },
      },
      orderBy: [
        { repo: { name: "asc" } },
        { number: "asc" },
      ],
    });

    const now = new Date();

    const formatted = issues.map((issue) => {
      const spotsTaken = issue.claims.length;
      const isAvailable = spotsTaken < issue.spots;
      const occupiedTeams = Array.from(new Set(issue.claims.map((c) => c.member.team)));

      return {
        id: issue.id,
        repoOwner: issue.repo.owner,
        repoName: issue.repo.name,
        number: issue.number,
        title: issue.title,
        level: issue.level,
        spotsTotal: issue.spots,
        spotsTaken,
        isAvailable,
        githubUrl: `https://github.com/${issue.repo.owner}/${issue.repo.name}/issues/${issue.number}`,
        claimTemplate: "Claiming this issue",
        occupiedTeams,
        claims: issue.claims.map((c) => ({
          id: c.id,
          memberId: c.member.id,
          displayName: c.member.displayName,
          githubLogin: c.member.githubLogin,
          team: c.member.team,
          status: c.status,
          createdAt: c.claimedAt.toISOString(),
          deadline: c.deadline.toISOString(),
          isExpired: c.deadline < now,
        })),
        waitlistCount: issue.waitlistEntries.length,
        waitlist: issue.waitlistEntries.map((w) => ({
          id: w.id,
          queuePosition: w.position,
          displayName: w.member.displayName,
          githubLogin: w.member.githubLogin,
          team: w.member.team,
        })),
      };
    });

    return reply.status(200).send({
      statusCode: 200,
      count: formatted.length,
      issues: formatted,
    });
  });
};
