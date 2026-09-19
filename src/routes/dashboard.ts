/**
 * dashboard.ts — Phase B6
 *
 * Member dashboard endpoint (login required).
 * Returns member's active claims with live deadline countdowns, PRs & scoring
 * against tier cap, Easy issues remaining, free active-claim slots, and waitlist positions.
 */

import { FastifyPluginAsync } from "fastify";
import { prisma } from "../db.js";
import { resolveSession } from "../auth/session.js";
import { readSessionToken } from "../auth/requestHelpers.js";
import { getMemberScore } from "../domain/scoring.js";

export interface DashboardRoutesOptions {
  prismaClient?: typeof prisma;
}

export const dashboardRoutes: FastifyPluginAsync<DashboardRoutesOptions> = async (app, opts) => {
  const db = opts.prismaClient ?? prisma;

  /**
   * GET /api/dashboard
   * Returns current authenticated user's dashboard statistics.
   */
  app.get("/dashboard", async (request, reply) => {
    const rawToken = readSessionToken(request);
    const session = await resolveSession(db, rawToken);

    if (!session) {
      return reply.status(401).send({
        statusCode: 401,
        error: "Unauthorized",
        message: "Authentication required to access member dashboard",
      });
    }

    const memberId = session.memberId;
    const member = session.member;

    // 1. Scoring & PR breakdown
    const score = await getMemberScore(db, memberId);

    // 2. Active & pr_raised claims
    const activeClaims = await db.claim.findMany({
      where: {
        memberId,
        status: { in: ["active", "pr_raised"] },
      },
      include: {
        issue: {
          include: {
            repo: {
              select: {
                owner: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { claimedAt: "asc" },
    });

    // 3. Past / completed claims (for history)
    const historyClaims = await db.claim.findMany({
      where: {
        memberId,
        status: { in: ["merged", "expired", "released", "rejected"] },
      },
      include: {
        issue: {
          include: {
            repo: {
              select: {
                owner: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { claimedAt: "desc" },
      take: 20,
    });

    // 4. Easy claim usage (lifetime count of accepted Easy claims)
    const easyClaimsCount = await db.claim.count({
      where: {
        memberId,
        issue: {
          level: "easy",
        },
      },
    });

    // 5. Active waitlist entries
    const waitlistEntries = await db.waitlistEntry.findMany({
      where: {
        memberId,
        resolvedAt: null,
      },
      include: {
        issue: {
          include: {
            repo: {
              select: {
                owner: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { position: "asc" },
    });

    const isTech = member.tier === "tech";
    const easyRemaining = isTech ? 0 : Math.max(0, 3 - easyClaimsCount);
    const freeActiveSlots = Math.max(0, 2 - activeClaims.length);
    const capReached = score.raw >= score.tierCap;

    return reply.status(200).send({
      statusCode: 200,
      member: {
        id: member.id,
        githubLogin: member.githubLogin,
        displayName: member.displayName,
        department: member.department,
        team: member.team,
        tier: member.tier,
        isAdmin: member.isAdmin,
      },
      scoring: {
        raw: score.raw,
        capped: score.capped,
        tierCap: score.tierCap,
        capReached,
        totalPrs: score.totalPrs,
        mergedPrs: score.mergedPrs,
        prBreakdown: score.prBreakdown,
      },
      limits: {
        activeClaimsCount: activeClaims.length,
        maxActiveSlots: 2,
        freeActiveSlots,
        easyClaimsCount,
        maxEasyClaims: 3,
        easyRemaining,
        isTech,
        techCannotClaimEasy: isTech,
      },
      activeClaims: activeClaims.map((c) => ({
        id: c.id,
        issueId: c.issueId,
        repoOwner: c.issue.repo.owner,
        repoName: c.issue.repo.name,
        issueNumber: c.issue.number,
        issueTitle: c.issue.title,
        level: c.issue.level,
        status: c.status,
        createdAt: c.claimedAt.toISOString(),
        deadline: c.deadline.toISOString(),
        githubUrl: `https://github.com/${c.issue.repo.owner}/${c.issue.repo.name}/issues/${c.issue.number}`,
      })),
      waitlistEntries: waitlistEntries.map((w) => ({
        id: w.id,
        issueId: w.issueId,
        queuePosition: w.position,
        repoOwner: w.issue.repo.owner,
        repoName: w.issue.repo.name,
        issueNumber: w.issue.number,
        issueTitle: w.issue.title,
        level: w.issue.level,
        createdAt: w.queuedAt.toISOString(),
        githubUrl: `https://github.com/${w.issue.repo.owner}/${w.issue.repo.name}/issues/${w.issue.number}`,
      })),
      historyClaims: historyClaims.map((c) => ({
        id: c.id,
        issueId: c.issueId,
        repoOwner: c.issue.repo.owner,
        repoName: c.issue.repo.name,
        issueNumber: c.issue.number,
        issueTitle: c.issue.title,
        level: c.issue.level,
        status: c.status,
        createdAt: c.claimedAt.toISOString(),
        deadline: c.deadline.toISOString(),
      })),
    });
  });
};
