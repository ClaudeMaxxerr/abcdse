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
import { getMemberScore, computeClaimsNeededToReachCap, computePotentialPoints } from "../domain/scoring.js";
import { Department, Team, ClaimStatus } from "@prisma/client";
import { z } from "zod";
import { deriveTier, detectForbiddenFields } from "./registration.js";
import {
  ACTIVE_CLAIM_STATUSES,
  LIFETIME_EASY_CLAIM_STATUSES,
  COMMITTED_CLAIM_STATUSES,
} from "../domain/claimConstants.js";

export interface DashboardRoutesOptions {
  prismaClient?: typeof prisma;
}

const profileUpdateSchema = z
  .object({
    department: z.nativeEnum(Department),
    team: z.nativeEnum(Team),
  })
  .strict();

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

    // 2. Active claims only (status = 'active') per § 2.4 — claims with PR raised ('pr_raised') have freed their slot
    const activeClaims = await db.claim.findMany({
      where: {
        memberId,
        status: { in: [...ACTIVE_CLAIM_STATUSES] },
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

    // 3. Past / completed / PR-raised claims (for history)
    const historyClaims = await db.claim.findMany({
      where: {
        memberId,
        status: { in: [ClaimStatus.pr_raised, ClaimStatus.merged, ClaimStatus.expired, ClaimStatus.released, ClaimStatus.rejected] },
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

    // 4. Claims and PR counts for self-correction eligibility:
    // Only claims representing committed work (active, pr_raised, merged) block editing.
    // Released, expired, and rejected claims do NOT block editing.
    const committedClaimsCount = await db.claim.count({
      where: {
        memberId,
        status: { in: [...COMMITTED_CLAIM_STATUSES] },
      },
    });
    const prsCount = await db.pullRequest.count({
      where: { memberId },
    });

    // Member PRs for potential points and claimsNeededToReachCap
    const memberPrs = await db.pullRequest.findMany({
      where: { memberId, countsForScore: true },
      include: { issue: { select: { level: true } } },
      orderBy: { openedAt: "asc" },
    });

    const potentialPoints = score.potentialPoints ?? computePotentialPoints(memberPrs);
    const claimsNeededToReachCap = computeClaimsNeededToReachCap(memberPrs, score.tierCap);
    const maxClaimsAllowed = potentialPoints >= score.tierCap ? claimsNeededToReachCap + 1 : null;
    const isClaimBlockedByCap = Boolean(potentialPoints >= score.tierCap && committedClaimsCount >= (claimsNeededToReachCap + 1));
    const capCoveredBlockedReason = isClaimBlockedByCap
      ? `Your existing pull requests already cover your ${score.tierCap}-point cap. You cannot claim more issues. Focus on the ones you have — quality decides which PRs are merged.`
      : null;

    // 5. Easy claim usage (lifetime count of accepted Easy claims: active, pr_raised, merged)
    const easyClaimsCount = await db.claim.count({
      where: {
        memberId,
        status: { in: [...LIFETIME_EASY_CLAIM_STATUSES] },
        issue: {
          level: "easy",
        },
      },
    });

    // Hard claim usage (lifetime count of accepted Hard claims: active, pr_raised, merged)
    const hardClaimsCount = await db.claim.count({
      where: {
        memberId,
        status: { in: [...COMMITTED_CLAIM_STATUSES] },
        issue: {
          level: "hard",
        },
      },
    });

    // 6. Active waitlist entries
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
    const hardRemaining = isTech ? null : Math.max(0, 2 - hardClaimsCount);
    const maxHardClaims = isTech ? null : 2;
    const freeActiveSlots = Math.max(0, 2 - activeClaims.length);
    const capReached = score.raw >= score.tierCap;
    const canEditProfile = Boolean(committedClaimsCount === 0 && prsCount === 0);

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
        canEditProfile,
      },
      scoring: {
        raw: score.raw,
        capped: score.capped,
        tierCap: score.tierCap,
        potentialPoints,
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
        hardClaimsCount,
        maxHardClaims,
        hardRemaining,
        isTech,
        techCannotClaimEasy: isTech,
        committedClaimsCount,
        claimsNeededToReachCap,
        maxClaimsAllowed,
        isClaimBlockedByCap,
        capCoveredBlockedReason,
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

  /**
   * PATCH /api/dashboard/profile
   * Allows a member to correct their own department & team.
   * STRICT GUARD: ONLY allowed when member has 0 claims and 0 PRs.
   * Audited.
   */
  const handleProfileUpdate = async (request: any, reply: any) => {
    const rawToken = readSessionToken(request);
    const session = await resolveSession(db, rawToken);

    if (!session) {
      return reply.status(401).send({
        statusCode: 401,
        error: "Unauthorized",
        message: "Authentication required",
      });
    }

    const memberId = session.memberId;

    // Check committed claims & PR counts (only active, pr_raised, merged block editing)
    const committedClaimsCount = await db.claim.count({
      where: {
        memberId,
        status: { in: [...COMMITTED_CLAIM_STATUSES] },
      },
    });
    const prsCount = await db.pullRequest.count({ where: { memberId } });

    if (committedClaimsCount > 0 || prsCount > 0) {
      return reply.status(403).send({
        statusCode: 403,
        error: "Forbidden",
        message: "Department and team cannot be changed after making claims or submitting pull requests. Please contact an admin.",
      });
    }

    // Mass-assignment defence
    const forbidden = detectForbiddenFields(request.body);
    if (forbidden.length > 0) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: `Request body must not contain: ${forbidden.join(", ")}`,
      });
    }

    // Strict schema validation
    const parsed = profileUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: parsed.error.issues.map((i) => i.message).join("; "),
        details: parsed.error.issues,
      });
    }

    const { department, team } = parsed.data;
    const tier = deriveTier(department);

    const beforeSnapshot = {
      department: session.member.department,
      team: session.member.team,
      tier: session.member.tier,
    };

    const updated = await db.member.update({
      where: { id: memberId },
      data: {
        department,
        team,
        tier,
      },
    });

    await db.auditLog.create({
      data: {
        actorMemberId: memberId,
        actorIp: request.ip,
        action: "member_self_corrected",
        targetType: "Member",
        targetId: memberId,
        beforeJson: JSON.stringify(beforeSnapshot),
        afterJson: JSON.stringify({ department: updated.department, team: updated.team, tier: updated.tier }),
      },
    });

    request.log.info(
      {
        memberId,
        githubLogin: session.member.githubLogin,
        department,
        team,
        tier,
      },
      "Member self-corrected department/team from dashboard"
    );

    return reply.status(200).send({
      statusCode: 200,
      message: "Profile updated successfully",
      member: {
        id: updated.id,
        githubLogin: updated.githubLogin,
        department: updated.department,
        team: updated.team,
        tier: updated.tier,
      },
    });
  };

  app.patch<{ Body: unknown }>("/dashboard/profile", { preHandler: app.csrfProtection }, handleProfileUpdate);
  app.post<{ Body: unknown }>("/dashboard/profile", { preHandler: app.csrfProtection }, handleProfileUpdate);
};
