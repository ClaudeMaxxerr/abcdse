/**
 * admin.ts — Phase B7
 *
 * Admin panel routes. ALL routes are protected by the admin guard which:
 *   - Resolves the session cookie
 *   - Checks githubUserId against ADMIN_GITHUB_USER_IDS allowlist (env var)
 *   - Logs every check
 *   - Returns 403 if not on the allowlist (regardless of any isAdmin field in DB)
 *
 * Admin routes:
 *   === Members ===
 *   GET    /api/admin/members                    — list all members
 *   PATCH  /api/admin/members/:id                — correct department/team/tier
 *   PATCH  /api/admin/members/:id/deactivate     — soft-deactivate a member
 *
 *   === Claims ===
 *   GET    /api/admin/claims                     — list all claims
 *   POST   /api/admin/claims/:id/expire          — manually expire a claim
 *   POST   /api/admin/claims/:id/restore         — restore an expired claim
 *   POST   /api/admin/claims/:id/release         — force-release (free the spot)
 *
 *   === Pull Request Overrides ===
 *   PATCH  /api/admin/prs/:id/override           — mark PR as not counting (reason required)
 *
 *   === Issues ===
 *   GET    /api/admin/issues                     — list all issues
 *   PATCH  /api/admin/issues/:id                 — correct level, adjust spots, close for claiming
 *
 *   === Event Control ===
 *   GET    /api/admin/event                      — get event settings
 *   PATCH  /api/admin/event                      — set deadline, open/close registration
 *
 *   === Scoring ===
 *   POST   /api/admin/scores/recompute           — trigger score re-derivation (no-op: scores are always derived)
 *   GET    /api/admin/scores/snapshot            — return derived scores for all members
 *
 *   === CSV Exports ===
 *   GET    /api/admin/export/members             — CSV of all members
 *   GET    /api/admin/export/claims              — CSV of all claims
 *   GET    /api/admin/export/scores              — CSV of member scores
 *
 *   === Audit Log ===
 *   GET    /api/admin/audit-log                  — list audit log entries
 *
 *   === Bot Control ===
 *   GET    /api/admin/bot/history                — list bot comments
 *   POST   /api/admin/bot/repost                 — re-post a failed bot comment
 *   GET    /api/admin/bot/dry-run                — get current dry-run setting
 *   PATCH  /api/admin/bot/dry-run                — enable/disable dry-run mode
 *
 *   === Session Management ===
 *   PATCH  /api/admin/registration/lock          — toggle registration open/closed
 *   POST   /api/admin/sessions/revoke            — revoke a session by token hash
 */

import { FastifyPluginAsync } from "fastify";
import { prisma } from "../db.js";
import { makeAdminGuard } from "../auth/adminGuard.js";
import { getAllMemberScores, getTeamScores } from "../domain/scoring.js";
import { z } from "zod";
import { config } from "../config.js";
import { Department, Team, Tier, ClaimStatus, IssueLevel } from "@prisma/client";

export interface AdminRoutesOptions {
  prismaClient?: typeof prisma;
}

const REGISTRATION_CONFIG_KEY = "registration_open";
const BOT_DRY_RUN_CONFIG_KEY = "bot_dry_run";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds an AuditLog row and writes it to db. */
async function writeAudit(
  db: typeof prisma,
  actorMemberId: string | null,
  actorIp: string,
  action: string,
  targetType: string,
  targetId: string,
  beforeJson: unknown,
  afterJson: unknown
) {
  await db.auditLog.create({
    data: {
      actorMemberId,
      actorIp,
      action,
      targetType,
      targetId,
      beforeJson: beforeJson != null ? JSON.stringify(beforeJson) : null,
      afterJson: afterJson != null ? JSON.stringify(afterJson) : null,
    },
  });
}

/** Converts an array of objects to CSV string. */
function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ];
  return lines.join("\r\n");
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const adminRoutes: FastifyPluginAsync<AdminRoutesOptions> = async (app, opts) => {
  const db = opts.prismaClient ?? prisma;
  const adminGuard = makeAdminGuard(db);

  // All routes in this plugin require admin access (checked at onRequest before body parsing)
  app.addHook("onRequest", adminGuard);

  // =========================================================================
  // MEMBERS
  // =========================================================================

  /**
   * GET /api/admin/members
   * List all registered members.
   */
  app.get("/members", async (_request, reply) => {
    const members = await db.member.findMany({
      select: {
        id: true,
        githubUserId: true,
        githubLogin: true,
        displayName: true,
        department: true,
        team: true,
        tier: true,
        isAdmin: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return reply.status(200).send({
      statusCode: 200,
      count: members.length,
      members: members.map((m) => ({
        ...m,
        githubUserId: m.githubUserId.toString(),
      })),
    });
  });

  /**
   * PATCH /api/admin/members/:id
   * Correct a wrong department, team or tier. Every change is audit-logged.
   * Body: { department?, team?, tier? }
   */
  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/members/:id",
    async (request, reply) => {
      const session = (request as any).session;

      const schema = z.object({
        department: z.nativeEnum(Department).optional(),
        team: z.nativeEnum(Team).optional(),
        tier: z.nativeEnum(Tier).optional(),
      });

      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: "Body must contain at least one of: department, team, tier",
        });
      }

      const { department, team } = parsed.data;
      const tier = parsed.data.tier ?? (department ? (department === Department.technical ? Tier.tech : Tier.general) : undefined);

      if (!department && !team && !tier) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: "At least one field must be provided to update",
        });
      }

      const member = await db.member.findUnique({ where: { id: request.params.id } });
      if (!member) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Member not found" });
      }

      const beforeSnapshot = {
        department: member.department,
        team: member.team,
        tier: member.tier,
      };

      const updated = await db.member.update({
        where: { id: request.params.id },
        data: {
          ...(department ? { department } : {}),
          ...(team ? { team } : {}),
          ...(tier ? { tier } : {}),
        },
      });

      await writeAudit(
        db,
        session?.memberId ?? null,
        request.ip,
        "member_corrected",
        "Member",
        request.params.id,
        beforeSnapshot,
        { department: updated.department, team: updated.team, tier: updated.tier }
      );

      return reply.status(200).send({
        statusCode: 200,
        message: "Member updated",
        member: {
          id: updated.id,
          githubLogin: updated.githubLogin,
          department: updated.department,
          team: updated.team,
          tier: updated.tier,
        },
      });
    }
  );

  /**
   * PATCH /api/admin/members/:id/deactivate
   * Soft-deactivate a member (isAdmin = false, revoke all sessions).
   * Body: { reason: string }
   */
  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/members/:id/deactivate",
    async (request, reply) => {
      const session = (request as any).session;

      const schema = z.object({ reason: z.string().min(5) });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: "Body must be { reason: string (min 5 chars) }",
        });
      }

      const member = await db.member.findUnique({ where: { id: request.params.id } });
      if (!member) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Member not found" });
      }

      // Revoke all active sessions
      await db.session.updateMany({
        where: { memberId: request.params.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      // Soft-deactivate: we mark isAdmin false and store deactivation reason in audit
      await db.member.update({
        where: { id: request.params.id },
        data: { isAdmin: false },
      });

      await writeAudit(
        db,
        session?.memberId ?? null,
        request.ip,
        "member_deactivated",
        "Member",
        request.params.id,
        { githubLogin: member.githubLogin, isAdmin: member.isAdmin },
        { reason: parsed.data.reason, deactivatedAt: new Date().toISOString() }
      );

      return reply.status(200).send({
        statusCode: 200,
        message: "Member deactivated and all sessions revoked",
      });
    }
  );

  // =========================================================================
  // CLAIMS
  // =========================================================================

  /**
   * GET /api/admin/claims
   * List claims with optional status filter. ?status=active|expired|merged|...
   */
  app.get<{ Querystring: { status?: string; limit?: string; offset?: string } }>(
    "/claims",
    async (request, reply) => {
      const limit = Math.min(parseInt(request.query.limit ?? "200", 10), 1000);
      const offset = parseInt(request.query.offset ?? "0", 10);

      const statusFilter = request.query.status
        ? (request.query.status as ClaimStatus)
        : undefined;

      const claims = await db.claim.findMany({
        where: statusFilter ? { status: statusFilter } : undefined,
        take: limit,
        skip: offset,
        orderBy: { claimedAt: "desc" },
        include: {
          member: { select: { githubLogin: true, displayName: true, team: true } },
          issue: {
            select: {
              number: true,
              level: true,
              title: true,
              repo: { select: { name: true } },
            },
          },
        },
      });

      return reply.status(200).send({
        statusCode: 200,
        count: claims.length,
        claims: claims.map((c) => ({
          ...c,
          commentId: c.commentId.toString(),
        })),
      });
    }
  );

  /**
   * POST /api/admin/claims/:id/expire
   * Manually expire an active claim.
   * Body: { reason: string }
   */
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/claims/:id/expire",
    async (request, reply) => {
      const session = (request as any).session;

      const schema = z.object({ reason: z.string().min(5) });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: "Body must be { reason: string (min 5 chars) }",
        });
      }

      const claim = await db.claim.findUnique({
        where: { id: request.params.id },
        include: { member: { select: { githubLogin: true } } },
      });
      if (!claim) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Claim not found" });
      }
      if (claim.status !== ClaimStatus.active && claim.status !== ClaimStatus.pr_raised) {
        return reply.status(409).send({
          statusCode: 409,
          error: "Conflict",
          message: `Claim is already in status '${claim.status}'; only active or pr_raised claims can be expired`,
        });
      }

      const before = { status: claim.status, deadline: claim.deadline.toISOString() };

      await db.claim.update({
        where: { id: request.params.id },
        data: { status: ClaimStatus.expired },
      });

      await writeAudit(
        db,
        session?.memberId ?? null,
        request.ip,
        "claim_expired_by_admin",
        "Claim",
        request.params.id,
        before,
        { status: "expired", reason: parsed.data.reason, expiredAt: new Date().toISOString() }
      );

      return reply.status(200).send({ statusCode: 200, message: "Claim expired" });
    }
  );

  /**
   * POST /api/admin/claims/:id/restore
   * Restore an expired claim back to active with a fresh deadline.
   * Body: { reason: string }
   */
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/claims/:id/restore",
    async (request, reply) => {
      const session = (request as any).session;

      const schema = z.object({ reason: z.string().min(5) });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: "Body must be { reason: string (min 5 chars) }",
        });
      }

      const claim = await db.claim.findUnique({ where: { id: request.params.id } });
      if (!claim) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Claim not found" });
      }
      if (claim.status !== ClaimStatus.expired) {
        return reply.status(409).send({
          statusCode: 409,
          error: "Conflict",
          message: `Claim is in status '${claim.status}'; only expired claims can be restored`,
        });
      }

      const before = { status: claim.status, deadline: claim.deadline.toISOString() };
      const newDeadline = new Date(Date.now() + config.CLAIM_TTL_HOURS * 3_600_000);

      await db.claim.update({
        where: { id: request.params.id },
        data: { status: ClaimStatus.active, deadline: newDeadline },
      });

      await writeAudit(
        db,
        session?.memberId ?? null,
        request.ip,
        "claim_restored_by_admin",
        "Claim",
        request.params.id,
        before,
        { status: "active", newDeadline: newDeadline.toISOString(), reason: parsed.data.reason }
      );

      return reply.status(200).send({
        statusCode: 200,
        message: "Claim restored",
        newDeadline: newDeadline.toISOString(),
      });
    }
  );

  /**
   * POST /api/admin/claims/:id/release
   * Force-release a claim (frees the spot, sets status to released).
   * Body: { reason: string }
   */
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/claims/:id/release",
    async (request, reply) => {
      const session = (request as any).session;

      const schema = z.object({ reason: z.string().min(5) });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: "Body must be { reason: string (min 5 chars) }",
        });
      }

      const claim = await db.claim.findUnique({ where: { id: request.params.id } });
      if (!claim) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Claim not found" });
      }

      const before = { status: claim.status };

      await db.claim.update({
        where: { id: request.params.id },
        data: { status: ClaimStatus.released },
      });

      await writeAudit(
        db,
        session?.memberId ?? null,
        request.ip,
        "claim_released_by_admin",
        "Claim",
        request.params.id,
        before,
        { status: "released", reason: parsed.data.reason, releasedAt: new Date().toISOString() }
      );

      return reply.status(200).send({ statusCode: 200, message: "Claim released" });
    }
  );

  // =========================================================================
  // PULL REQUEST OVERRIDES
  // =========================================================================

  /**
   * PATCH /api/admin/prs/:id/override
   * Mark a PR as not counting for score (e.g. empty / copied / no real attempt per § 2.7).
   * Reason is MANDATORY. Audited.
   * Body: { countsForScore: boolean, reason: string }
   */
  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/prs/:id/override",
    async (request, reply) => {
      const session = (request as any).session;

      const schema = z.object({
        countsForScore: z.boolean(),
        reason: z.string().min(10, "Reason must be at least 10 characters"),
      });

      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: parsed.error.issues.map((i) => i.message).join("; "),
        });
      }

      const pr = await db.pullRequest.findUnique({
        where: { id: request.params.id },
        include: { member: { select: { githubLogin: true } } },
      });
      if (!pr) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "PullRequest not found" });
      }

      const before = { countsForScore: pr.countsForScore };

      await db.pullRequest.update({
        where: { id: request.params.id },
        data: { countsForScore: parsed.data.countsForScore },
      });

      await writeAudit(
        db,
        session?.memberId ?? null,
        request.ip,
        "pr_override",
        "PullRequest",
        request.params.id,
        before,
        {
          countsForScore: parsed.data.countsForScore,
          reason: parsed.data.reason,
          prNumber: pr.number,
          memberLogin: pr.member.githubLogin,
          overriddenAt: new Date().toISOString(),
        }
      );

      return reply.status(200).send({
        statusCode: 200,
        message: `PR #${pr.number} countsForScore set to ${parsed.data.countsForScore}`,
        pr: { id: pr.id, number: pr.number, countsForScore: parsed.data.countsForScore },
      });
    }
  );

  /**
   * POST /api/admin/prs/link
   * Manually link a PR to a claim/issue for recovery when webhook delivery was lost.
   * Body: { repoOwner: string, repoName: string, prNumber: number, issueNumber: number, memberLogin?: string, reason?: string }
   */
  app.post<{ Body: unknown }>(
    "/prs/link",
    async (request, reply) => {
      const session = (request as any).session;

      const schema = z.object({
        repoOwner: z.string().min(1),
        repoName: z.string().min(1),
        prNumber: z.number().int().positive(),
        issueNumber: z.number().int().positive(),
        memberLogin: z.string().optional(),
        reason: z.string().min(3).optional().default("Manual link by admin"),
      });

      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: parsed.error.issues.map((i) => i.message).join("; "),
        });
      }

      const { repoOwner, repoName, prNumber, issueNumber, memberLogin, reason } = parsed.data;

      // 1. Resolve repository
      const repo = await db.repo.findFirst({
        where: {
          owner: { equals: repoOwner, mode: "insensitive" },
          name: { equals: repoName, mode: "insensitive" },
        },
      });
      if (!repo) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: `Repository ${repoOwner}/${repoName} not found`,
        });
      }

      // 2. Resolve issue
      const issue = await db.issue.findFirst({
        where: {
          repoId: repo.id,
          number: issueNumber,
        },
      });
      if (!issue) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: `Issue #${issueNumber} not found in repository ${repoOwner}/${repoName}`,
        });
      }

      // 3. Resolve member & claim
      let targetMemberId: string | null = null;
      let targetClaim: any = null;

      if (memberLogin) {
        const member = await db.member.findFirst({
          where: {
            githubLogin: { equals: memberLogin, mode: "insensitive" },
          },
        });
        if (!member) {
          return reply.status(404).send({
            statusCode: 404,
            error: "Not Found",
            message: `Member ${memberLogin} not found`,
          });
        }
        targetMemberId = member.id;
        targetClaim = await db.claim.findFirst({
          where: {
            issueId: issue.id,
            memberId: member.id,
          },
        });
      } else {
        targetClaim = await db.claim.findFirst({
          where: {
            issueId: issue.id,
            status: { in: [ClaimStatus.active, ClaimStatus.pr_raised] },
          },
          include: { member: true },
        });
        if (!targetClaim) {
          targetClaim = await db.claim.findFirst({
            where: { issueId: issue.id },
            include: { member: true },
          });
        }
        if (targetClaim) {
          targetMemberId = targetClaim.memberId;
        }
      }

      if (!targetMemberId || !targetClaim) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: `No claim found on issue #${issueNumber} to link PR #${prNumber} to.`,
        });
      }

      // 4. Update or create PullRequest and update claim to pr_raised
      let prRecord: any;
      await db.$transaction(async (tx: any) => {
        if (targetClaim.status !== ClaimStatus.pr_raised && targetClaim.status !== ClaimStatus.merged) {
          await tx.claim.update({
            where: { id: targetClaim.id },
            data: { status: ClaimStatus.pr_raised },
          });
        }

        const existingPr = await tx.pullRequest.findFirst({
          where: {
            repoId: repo.id,
            number: prNumber,
          },
        });

        if (existingPr) {
          prRecord = await tx.pullRequest.update({
            where: { id: existingPr.id },
            data: {
              issueId: issue.id,
              memberId: targetMemberId!,
              countsForScore: true,
            },
          });
        } else {
          prRecord = await tx.pullRequest.create({
            data: {
              repoId: repo.id,
              number: prNumber,
              githubPrId: BigInt(Date.now()),
              memberId: targetMemberId!,
              issueId: issue.id,
              openedAt: new Date(),
              merged: false,
              countsForScore: true,
            },
          });
        }
      });

      // 5. Audit log
      await writeAudit(
        db,
        session?.memberId ?? null,
        request.ip,
        "pr_manually_linked",
        "PullRequest",
        prRecord.id,
        { claimId: targetClaim.id, beforeStatus: targetClaim.status },
        {
          repo: `${repoOwner}/${repoName}`,
          prNumber,
          issueNumber,
          memberId: targetMemberId,
          reason,
          prId: prRecord.id,
          linkedAt: new Date().toISOString(),
        }
      );

      return reply.status(200).send({
        statusCode: 200,
        message: `PR #${prNumber} successfully linked to issue #${issueNumber}`,
        pullRequest: {
          id: prRecord.id,
          number: prRecord.number,
          issueId: prRecord.issueId,
          memberId: prRecord.memberId,
          countsForScore: prRecord.countsForScore,
        },
        claim: {
          id: targetClaim.id,
          status: ClaimStatus.pr_raised,
        },
      });
    }
  );

  // =========================================================================
  // PULL REQUESTS
  // =========================================================================

  /**
   * POST /api/admin/prs/:id/merge-decision
   * Explicit organiser merge decision on a PR.
   * Body: { merged: boolean, countsForScore?: boolean, reason?: string }
   * Sets merged, countsForScore, and mergeDecisionLocked = true.
   * Updates linked Claim status (merged -> merged, otherwise pr_raised).
   * If merged = true, demotes and locks any competing PR on the same issue.
   * Writes AuditLog with before/after snapshots.
   */
  app.post<{
    Params: { id: string };
    Body: unknown;
  }>("/prs/:id/merge-decision", async (request, reply) => {
    const session = (request as any).session;
    const { id } = request.params;

    const schema = z.object({
      merged: z.boolean(),
      countsForScore: z.boolean().optional(),
      reason: z.string().optional().default("Organiser merge decision"),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: parsed.error.issues.map((i) => i.message).join("; "),
      });
    }

    const { merged, reason } = parsed.data;

    // 1. Find target PR
    const pr = await db.pullRequest.findUnique({
      where: { id },
      include: {
        issue: true,
        repo: true,
        member: true,
      },
    });

    if (!pr) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: `PullRequest with id ${id} not found`,
      });
    }

    const countsForScore = parsed.data.countsForScore ?? pr.countsForScore;

    const beforeSnapshot = {
      merged: pr.merged,
      countsForScore: pr.countsForScore,
      mergeDecisionLocked: pr.mergeDecisionLocked,
    };

    let updatedPr: any;
    const competingPrsUpdated: any[] = [];

    await db.$transaction(async (tx: any) => {
      // If setting this PR to merged, demote and lock any competing PRs on the same issue
      if (merged) {
        const competing = await tx.pullRequest.findMany({
          where: {
            issueId: pr.issueId,
            id: { not: pr.id },
          },
          include: { member: true },
        });

        for (const otherPr of competing) {
          const otherBefore = {
            merged: otherPr.merged,
            countsForScore: otherPr.countsForScore,
            mergeDecisionLocked: otherPr.mergeDecisionLocked,
          };

          const otherUpdated = await tx.pullRequest.update({
            where: { id: otherPr.id },
            data: {
              merged: false,
              mergeDecisionLocked: true,
            },
          });

          // Demote competing claim to pr_raised
          await tx.claim.updateMany({
            where: {
              issueId: pr.issueId,
              memberId: otherPr.memberId,
            },
            data: {
              status: ClaimStatus.pr_raised,
            },
          });

          competingPrsUpdated.push({
            pr: otherUpdated,
            before: otherBefore,
          });
        }
      }

      // Update target PR
      updatedPr = await tx.pullRequest.update({
        where: { id: pr.id },
        data: {
          merged,
          countsForScore,
          mergeDecisionLocked: true,
        },
      });

      // Update target member's claim status
      const targetClaimStatus = (merged && countsForScore) ? ClaimStatus.merged : ClaimStatus.pr_raised;
      await tx.claim.updateMany({
        where: {
          issueId: pr.issueId,
          memberId: pr.memberId,
        },
        data: {
          status: targetClaimStatus,
        },
      });
    });

    // Write audit log for competing PRs
    for (const comp of competingPrsUpdated) {
      await writeAudit(
        db,
        session?.memberId ?? null,
        request.ip,
        "pr_merge_decision_demoted",
        "PullRequest",
        comp.pr.id,
        comp.before,
        {
          merged: comp.pr.merged,
          countsForScore: comp.pr.countsForScore,
          mergeDecisionLocked: comp.pr.mergeDecisionLocked,
          reason: `Demoted because PR #${pr.number} awarded merge on issue #${pr.issue.number}`,
        }
      );
    }

    // Write audit log for target PR
    await writeAudit(
      db,
      session?.memberId ?? null,
      request.ip,
      "pr_merge_decision",
      "PullRequest",
      pr.id,
      beforeSnapshot,
      {
        merged: updatedPr.merged,
        countsForScore: updatedPr.countsForScore,
        mergeDecisionLocked: updatedPr.mergeDecisionLocked,
        reason,
      }
    );

    return reply.status(200).send({
      statusCode: 200,
      message: "Merge decision applied and locked",
      pullRequest: {
        id: updatedPr.id,
        number: updatedPr.number,
        merged: updatedPr.merged,
        countsForScore: updatedPr.countsForScore,
        mergeDecisionLocked: updatedPr.mergeDecisionLocked,
      },
      competingUpdated: competingPrsUpdated.map((c) => ({
        id: c.pr.id,
        number: c.pr.number,
        merged: c.pr.merged,
        mergeDecisionLocked: c.pr.mergeDecisionLocked,
      })),
    });
  });

  // =========================================================================
  // ISSUES
  // =========================================================================

  /**
   * GET /api/admin/issues
   * List all issues with repo info.
   */
  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    "/issues",
    async (request, reply) => {
      const limit = Math.min(parseInt(request.query.limit ?? "200", 10), 500);
      const offset = parseInt(request.query.offset ?? "0", 10);

      const issues = await db.issue.findMany({
        take: limit,
        skip: offset,
        orderBy: [{ repo: { name: "asc" } }, { number: "asc" }],
        include: {
          repo: { select: { owner: true, name: true } },
          _count: { select: { claims: true, waitlistEntries: true } },
        },
      });

      return reply.status(200).send({
        statusCode: 200,
        count: issues.length,
        issues: issues.map((i) => ({
          id: i.id,
          repoOwner: i.repo.owner,
          repoName: i.repo.name,
          number: i.number,
          title: i.title,
          level: i.level,
          spots: i.spots,
          claimCount: i._count.claims,
          waitlistCount: i._count.waitlistEntries,
          githubIssueId: i.githubIssueId.toString(),
        })),
      });
    }
  );

  /**
   * PATCH /api/admin/issues/:id
   * Correct level, adjust spots, or close an issue for claiming.
   * Body: { level?, spots?, closed? }
   */
  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/issues/:id",
    async (request, reply) => {
      const session = (request as any).session;

      const schema = z.object({
        level: z.nativeEnum(IssueLevel).optional(),
        spots: z.number().int().min(1).max(10).optional(),
        closed: z.boolean().optional(),
      });

      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: parsed.error.issues.map((i) => i.message).join("; "),
        });
      }

      if (!parsed.data.level && parsed.data.spots == null && parsed.data.closed == null) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: "At least one field must be provided (level, spots, or closed)",
        });
      }

      const issue = await db.issue.findUnique({ where: { id: request.params.id } });
      if (!issue) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Issue not found" });
      }

      const before = { level: issue.level, spots: issue.spots };
      const updateData: Record<string, unknown> = {};
      if (parsed.data.level) updateData.level = parsed.data.level;
      if (parsed.data.spots != null) updateData.spots = parsed.data.spots;
      // closed is stored as spots = 0 to prevent new claims without touching existing ones
      if (parsed.data.closed === true) updateData.spots = 0;

      const updated = await db.issue.update({
        where: { id: request.params.id },
        data: updateData as Parameters<typeof db.issue.update>[0]["data"],
      });

      await writeAudit(
        db,
        session?.memberId ?? null,
        request.ip,
        "issue_corrected",
        "Issue",
        request.params.id,
        before,
        { level: updated.level, spots: updated.spots, closed: parsed.data.closed }
      );

      return reply.status(200).send({
        statusCode: 200,
        message: "Issue updated",
        issue: { id: updated.id, level: updated.level, spots: updated.spots },
      });
    }
  );

  // =========================================================================
  // EVENT CONTROL
  // =========================================================================

  /**
   * GET /api/admin/event
   * Return current event settings (registration state, final deadline, freeze standings).
   */
  app.get("/event", async (_request, reply) => {
    const configs = await db.systemConfig.findMany({
      where: { key: { in: [REGISTRATION_CONFIG_KEY, "final_deadline", "freeze_standings"] } },
    });
    const map = Object.fromEntries(configs.map((c) => [c.key, c.value]));

    return reply.status(200).send({
      statusCode: 200,
      registrationOpen: map[REGISTRATION_CONFIG_KEY] !== "false",
      finalDeadline: map["final_deadline"] ?? config.FINAL_DEADLINE?.toISOString() ?? null,
      freezeStandings: map["freeze_standings"] === "true",
    });
  });

  /**
   * PATCH /api/admin/event
   * Set final deadline, freeze standings, and/or toggle registration.
   * Body: { open?: boolean, freezeStandings?: boolean, finalDeadline?: string (ISO-8601) }
   */
  app.patch<{ Body: unknown }>("/event", async (request, reply) => {
    const session = (request as any).session;

    const schema = z.object({
      open: z.boolean().optional(),
      freezeStandings: z.boolean().optional(),
      finalDeadline: z
        .string()
        .refine((d) => !isNaN(new Date(d).getTime()), { message: "finalDeadline must be a valid ISO-8601 date" })
        .optional(),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: parsed.error.issues.map((i) => i.message).join("; "),
      });
    }

    if (parsed.data.open == null && parsed.data.freezeStandings == null && !parsed.data.finalDeadline) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "At least one of: open, freezeStandings, finalDeadline must be provided",
      });
    }

    const updates: Array<{ key: string; value: string; action: string }> = [];

    if (parsed.data.open != null) {
      const val = parsed.data.open ? "true" : "false";
      await db.systemConfig.upsert({
        where: { key: REGISTRATION_CONFIG_KEY },
        update: { value: val },
        create: { key: REGISTRATION_CONFIG_KEY, value: val },
      });
      updates.push({ key: REGISTRATION_CONFIG_KEY, value: val, action: parsed.data.open ? "registration_unlocked" : "registration_locked" });
    }

    if (parsed.data.freezeStandings != null) {
      const val = parsed.data.freezeStandings ? "true" : "false";
      await db.systemConfig.upsert({
        where: { key: "freeze_standings" },
        update: { value: val },
        create: { key: "freeze_standings", value: val },
      });
      updates.push({
        key: "freeze_standings",
        value: val,
        action: parsed.data.freezeStandings ? "standings_frozen" : "standings_unfrozen",
      });
    }

    if (parsed.data.finalDeadline) {
      await db.systemConfig.upsert({
        where: { key: "final_deadline" },
        update: { value: parsed.data.finalDeadline },
        create: { key: "final_deadline", value: parsed.data.finalDeadline },
      });
      updates.push({ key: "final_deadline", value: parsed.data.finalDeadline, action: "final_deadline_set" });
    }

    for (const u of updates) {
      await writeAudit(
        db,
        session?.memberId ?? null,
        request.ip,
        u.action,
        "SystemConfig",
        u.key,
        null,
        { value: u.value }
      );
    }

    return reply.status(200).send({ statusCode: 200, message: "Event settings updated", updates });
  });

  // =========================================================================
  // SCORING
  // =========================================================================

  /**
   * POST /api/admin/scores/recompute
   * Scores are always derived on-read (never stored), so this is a
   * no-op that returns the current snapshot. It exists for operator
   * confidence and to provide an explicit audit entry.
   */
  app.post("/scores/recompute", async (request, reply) => {
    const session = (request as any).session;

    const scores = await getAllMemberScores(db);

    await writeAudit(
      db,
      session?.memberId ?? null,
      request.ip,
      "scores_recomputed",
      "System",
      "all",
      null,
      { memberCount: scores.length, triggeredAt: new Date().toISOString() }
    );

    return reply.status(200).send({
      statusCode: 200,
      message: "Scores are always derived on read (never stored). Current snapshot returned.",
      memberCount: scores.length,
      scores: scores.map((s) => ({
        memberId: s.memberId,
        githubLogin: s.githubLogin,
        team: s.team,
        department: s.department,
        tier: s.tier,
        raw: s.raw,
        tierCap: s.tierCap,
        capped: s.capped,
        totalPrs: s.totalPrs,
        mergedPrs: s.mergedPrs,
      })),
    });
  });

  /**
   * GET /api/admin/scores/snapshot
   * Return derived scores for all members and team standings.
   */
  app.get("/scores/snapshot", async (_request, reply) => {
    const [memberScores, teamScores] = await Promise.all([
      getAllMemberScores(db),
      getTeamScores(db),
    ]);

    return reply.status(200).send({
      statusCode: 200,
      memberScores: memberScores.map((s) => ({
        memberId: s.memberId,
        githubLogin: s.githubLogin,
        displayName: s.displayName,
        team: s.team,
        department: s.department,
        tier: s.tier,
        raw: s.raw,
        tierCap: s.tierCap,
        capped: s.capped,
        totalPrs: s.totalPrs,
        mergedPrs: s.mergedPrs,
      })),
      teamScores: teamScores.map((t) => ({
        team: t.team,
        challengeTotal: t.challengeTotal,
        bonuses: t.bonuses,
        grandTotal: t.grandTotal,
        memberCount: t.memberScores.length,
        totalPrs: t.totalPrs,
        mergedPrs: t.mergedPrs,
      })),
    });
  });

  // =========================================================================
  // CSV EXPORTS
  // =========================================================================

  /**
   * GET /api/admin/export/members
   * CSV of all members.
   */
  app.get("/export/members", async (_request, reply) => {
    const members = await db.member.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        githubLogin: true,
        displayName: true,
        department: true,
        team: true,
        tier: true,
        isAdmin: true,
        createdAt: true,
      },
    });

    const rows = members.map((m) => ({
      id: m.id,
      githubLogin: m.githubLogin,
      displayName: m.displayName,
      department: m.department,
      team: m.team,
      tier: m.tier,
      isAdmin: m.isAdmin,
      createdAt: m.createdAt.toISOString(),
    }));

    reply
      .header("Content-Type", "text/csv")
      .header("Content-Disposition", 'attachment; filename="members.csv"')
      .send(toCsv(rows));
  });

  /**
   * GET /api/admin/export/claims
   * CSV of all claims.
   */
  app.get("/export/claims", async (_request, reply) => {
    const claims = await db.claim.findMany({
      orderBy: { claimedAt: "desc" },
      include: {
        member: { select: { githubLogin: true, team: true } },
        issue: { select: { number: true, level: true, repo: { select: { name: true } } } },
      },
    });

    const rows = claims.map((c) => ({
      id: c.id,
      memberId: c.memberId,
      githubLogin: c.member.githubLogin,
      team: c.member.team,
      repo: c.issue.repo.name,
      issueNumber: c.issue.number,
      level: c.issue.level,
      status: c.status,
      claimedAt: c.claimedAt.toISOString(),
      deadline: c.deadline.toISOString(),
      promotedAt: c.promotedAt?.toISOString() ?? "",
      commentId: c.commentId.toString(),
    }));

    reply
      .header("Content-Type", "text/csv")
      .header("Content-Disposition", 'attachment; filename="claims.csv"')
      .send(toCsv(rows));
  });

  /**
   * GET /api/admin/export/scores
   * CSV of member scores (derived).
   */
  app.get("/export/scores", async (_request, reply) => {
    const scores = await getAllMemberScores(db);

    const rows = scores.map((s, i) => ({
      rank: i + 1,
      githubLogin: s.githubLogin,
      displayName: s.displayName,
      team: s.team,
      department: s.department,
      tier: s.tier,
      raw: s.raw,
      tierCap: s.tierCap,
      capped: s.capped,
      totalPrs: s.totalPrs,
      mergedPrs: s.mergedPrs,
    }));

    reply
      .header("Content-Type", "text/csv")
      .header("Content-Disposition", 'attachment; filename="scores.csv"')
      .send(toCsv(rows));
  });

  // =========================================================================
  // AUDIT LOG
  // =========================================================================

  /**
   * GET /api/admin/audit-log
   * Returns the audit log, newest first.
   * Supports ?limit, ?offset, ?action, ?targetType filter.
   */
  app.get<{
    Querystring: { limit?: string; offset?: string; action?: string; targetType?: string };
  }>("/audit-log", async (request, reply) => {
    const limit = Math.min(parseInt(request.query.limit ?? "100", 10), 500);
    const offset = parseInt(request.query.offset ?? "0", 10);

    const where: Record<string, unknown> = {};
    if (request.query.action) where["action"] = request.query.action;
    if (request.query.targetType) where["targetType"] = request.query.targetType;

    const logs = await db.auditLog.findMany({
      take: limit,
      skip: offset,
      orderBy: { createdAt: "desc" },
      where,
      include: {
        actorMember: {
          select: { githubLogin: true, displayName: true },
        },
      },
    });

    return reply.status(200).send({
      statusCode: 200,
      count: logs.length,
      auditLog: logs,
    });
  });

  // =========================================================================
  // BOT CONTROL
  // =========================================================================

  /**
   * GET /api/admin/bot/history
   * List bot comments, newest first.
   */
  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    "/bot/history",
    async (request, reply) => {
      const limit = Math.min(parseInt(request.query.limit ?? "100", 10), 500);
      const offset = parseInt(request.query.offset ?? "0", 10);

      const comments = await db.botComment.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
        include: {
          issue: { select: { number: true, repo: { select: { name: true } } } },
          member: { select: { githubLogin: true } },
        },
      });

      return reply.status(200).send({
        statusCode: 200,
        count: comments.length,
        comments: comments.map((c) => ({
          id: c.id,
          issueNumber: c.issue.number,
          repo: c.issue.repo.name,
          memberLogin: c.member?.githubLogin ?? null,
          kind: c.kind,
          commentId: c.commentId.toString(),
          createdAt: c.createdAt.toISOString(),
        })),
      });
    }
  );

  /**
   * POST /api/admin/bot/repost
   * Re-post a failed bot comment by its recorded id.
   * In dry-run mode, returns what would be posted without posting.
   * Body: { botCommentId: string, body: string }
   */
  app.post<{ Body: unknown }>("/bot/repost", async (request, reply) => {
    const session = (request as any).session;

    const schema = z.object({
      botCommentId: z.string().uuid(),
      body: z.string().min(1),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Body must be { botCommentId: uuid, body: string }",
      });
    }

    const existing = await db.botComment.findUnique({ where: { id: parsed.data.botCommentId } });
    if (!existing) {
      return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "BotComment record not found" });
    }

    // Check dry-run from DB (runtime override takes precedence over env)
    const dryRunConfig = await db.systemConfig.findUnique({ where: { key: BOT_DRY_RUN_CONFIG_KEY } });
    const isDryRun = dryRunConfig ? dryRunConfig.value === "true" : config.BOT_DRY_RUN;

    await writeAudit(
      db,
      session?.memberId ?? null,
      request.ip,
      isDryRun ? "bot_repost_dry_run" : "bot_repost",
      "BotComment",
      parsed.data.botCommentId,
      { kind: existing.kind },
      { body: parsed.data.body, dryRun: isDryRun, repostedAt: new Date().toISOString() }
    );

    if (isDryRun) {
      return reply.status(200).send({
        statusCode: 200,
        dryRun: true,
        message: "DRY RUN: comment would have been posted (not actually sent)",
        body: parsed.data.body,
      });
    }

    // Real post happens via GitHub App — body is returned for the caller to post
    // (comment posting via GitHubApiClient requires App credentials available at runtime)
    return reply.status(200).send({
      statusCode: 200,
      dryRun: false,
      message: "Repost recorded. Use the body below with the GitHub App credentials to post via API.",
      body: parsed.data.body,
      commentRecord: {
        id: existing.id,
        kind: existing.kind,
        issueId: existing.issueId,
        memberId: existing.memberId,
      },
    });
  });

  /**
   * GET /api/admin/bot/dry-run
   * Get the current dry-run setting.
   */
  app.get("/bot/dry-run", async (_request, reply) => {
    const dryRunConfig = await db.systemConfig.findUnique({ where: { key: BOT_DRY_RUN_CONFIG_KEY } });
    const isDryRun = dryRunConfig ? dryRunConfig.value === "true" : config.BOT_DRY_RUN;

    return reply.status(200).send({
      statusCode: 200,
      dryRun: isDryRun,
      source: dryRunConfig ? "database" : "environment",
    });
  });

  /**
   * PATCH /api/admin/bot/dry-run
   * Enable or disable bot dry-run mode at runtime without restarting the server.
   * Body: { enabled: boolean }
   */
  app.patch<{ Body: unknown }>("/bot/dry-run", async (request, reply) => {
    const session = (request as any).session;

    const schema = z.object({ enabled: z.boolean() });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Body must be { enabled: boolean }",
      });
    }

    const val = parsed.data.enabled ? "true" : "false";
    await db.systemConfig.upsert({
      where: { key: BOT_DRY_RUN_CONFIG_KEY },
      update: { value: val },
      create: { key: BOT_DRY_RUN_CONFIG_KEY, value: val },
    });

    await writeAudit(
      db,
      session?.memberId ?? null,
      request.ip,
      parsed.data.enabled ? "bot_dry_run_enabled" : "bot_dry_run_disabled",
      "SystemConfig",
      BOT_DRY_RUN_CONFIG_KEY,
      null,
      { enabled: parsed.data.enabled }
    );

    return reply.status(200).send({
      statusCode: 200,
      message: `Bot dry-run mode ${parsed.data.enabled ? "enabled" : "disabled"}`,
      dryRun: parsed.data.enabled,
    });
  });

  // =========================================================================
  // SESSION MANAGEMENT (from Phase B5 — retained)
  // =========================================================================

  /**
   * PATCH /api/admin/registration/lock
   * Toggles the registration open/closed flag.
   * Body: { open: boolean }
   */
  app.patch<{ Body: unknown }>("/registration/lock", async (request, reply) => {
    const schema = z.object({ open: z.boolean() });
    const parsed = schema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Body must be { open: boolean }",
      });
    }

    const { open } = parsed.data;
    const session = (request as any).session;

    await db.systemConfig.upsert({
      where: { key: REGISTRATION_CONFIG_KEY },
      update: { value: open ? "true" : "false" },
      create: { key: REGISTRATION_CONFIG_KEY, value: open ? "true" : "false" },
    });

    await writeAudit(
      db,
      session?.memberId ?? null,
      request.ip,
      open ? "registration_unlocked" : "registration_locked",
      "SystemConfig",
      REGISTRATION_CONFIG_KEY,
      null,
      { open }
    );

    return reply.status(200).send({
      statusCode: 200,
      message: `Registration is now ${open ? "open" : "closed"}`,
      open,
    });
  });

  /**
   * POST /api/admin/sessions/revoke
   * Revokes a session by its token hash.
   * Body: { tokenHash: string }
   */
  app.post<{ Body: unknown }>("/sessions/revoke", async (request, reply) => {
    const schema = z.object({ tokenHash: z.string().min(1) });
    const parsed = schema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Body must be { tokenHash: string }",
      });
    }

    const { tokenHash } = parsed.data;
    const session = (request as any).session;

    const result = await db.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (result.count === 0) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: "Session not found or already revoked",
      });
    }

    await writeAudit(
      db,
      session?.memberId ?? null,
      request.ip,
      "session_revoked",
      "Session",
      tokenHash,
      null,
      { revokedAt: new Date().toISOString() }
    );

    return reply.status(200).send({
      statusCode: 200,
      message: "Session revoked",
      revoked: result.count,
    });
  });
};
