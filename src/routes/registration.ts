/**
 * registration.ts — Phase B5
 *
 * Registration completion and status endpoints.
 *
 *   GET /api/registration/status
 *     → returns { open: boolean }
 *
 *   POST /api/registration/complete
 *     → first-login form: department + team only
 *     → tier is DERIVED server-side from department (never accepted from client)
 *     → mass-assignment defence: reject any body containing tier, isAdmin,
 *       githubUserId or githubLogin
 *     → upsert by githubUserId (handles re-registration = update, not duplicate)
 *     → CSRF protected
 *     → requires active session
 */

import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { Department, Team, Tier } from "@prisma/client";
import { resolveSession } from "../auth/session.js";
import { readSessionToken } from "../auth/requestHelpers.js";

export interface RegistrationRoutesOptions {
  prismaClient?: typeof prisma;
}

/** Departments that map to the 'tech' tier (CONTEXT.md § 2.2) */
const TECH_DEPARTMENTS = new Set<Department>([Department.technical]);

/**
 * Derives the tier from the department server-side.
 * This is the ONLY place tier is computed; it must never be accepted from client input.
 */
export function deriveTier(department: Department): Tier {
  return TECH_DEPARTMENTS.has(department) ? Tier.tech : Tier.general;
}

/**
 * Display names for teams per CONTEXT.md § 2.1
 * (stored as enum; displayed in UI as these names)
 */
export const TEAM_DISPLAY_NAMES: Record<Team, string> = {
  [Team.NEXUS]: "Nexus",
  [Team.CIPHER]: "Cipher",
  [Team.BYTE_BRIGADE]: "Byte Brigade",
  [Team.ASCEND]: "Ascend",
  [Team.ECHO]: "Echo",
};

/**
 * Zod schema for registration completion.
 * ONLY department and team are accepted.
 * tier, isAdmin, githubUserId, githubLogin are forbidden (mass-assignment defence).
 */
const registrationBodySchema = z
  .object({
    department: z.nativeEnum(Department),
    team: z.nativeEnum(Team),
  })
  .strict(); // .strict() rejects any extra keys

/**
 * Additional mass-assignment check: explicitly reject bodies containing
 * protected fields, even if zod would strip them.
 * Returns the list of forbidden fields found.
 */
export function detectForbiddenFields(body: unknown): string[] {
  const forbidden = ["tier", "isAdmin", "githubUserId", "githubLogin"];
  if (typeof body !== "object" || body === null) return [];
  const keys = Object.keys(body as Record<string, unknown>);
  return forbidden.filter((f) => keys.includes(f));
}

const REGISTRATION_CONFIG_KEY = "registration_open";

export const registrationRoutes: FastifyPluginAsync<RegistrationRoutesOptions> = async (app, opts) => {
  const db = opts.prismaClient ?? prisma;

  /**
   * GET /api/registration/status
   * Public endpoint: returns whether registration is currently open.
   */
  app.get("/registration/status", async (_request, reply) => {
    const config = await db.systemConfig.findUnique({
      where: { key: REGISTRATION_CONFIG_KEY },
    });

    // Default: open = true unless explicitly set to "false"
    const open = config ? config.value !== "false" : true;

    return reply.status(200).send({
      statusCode: 200,
      open,
    });
  });

  /**
   * POST /api/registration/complete
   * Completes registration for a first-time login.
   * Also works as an update (idempotent) for existing members.
   *
   * Requires:
   *   - Active session (cookie)
   *   - CSRF token
   *   - Registration open
   *   - Body: { department, team } ONLY — any other field is rejected
   */
  app.post<{ Body: unknown }>(
    "/registration/complete",
    { preHandler: app.csrfProtection },
    async (request, reply) => {
      // 1. Resolve session
      const rawToken = readSessionToken(request);
      const session = await resolveSession(db, rawToken);

    if (!session) {
      return reply.status(401).send({
        statusCode: 401,
        error: "Unauthorized",
        message: "Authentication required",
      });
    }

    // 2. Check registration is open
    const regConfig = await db.systemConfig.findUnique({
      where: { key: REGISTRATION_CONFIG_KEY },
    });
    const registrationOpen = regConfig ? regConfig.value !== "false" : true;

    if (!registrationOpen) {
      return reply.status(403).send({
        statusCode: 403,
        error: "Forbidden",
        message: "Registration is currently closed",
      });
    }

    // 3. Mass-assignment defence: reject bodies with forbidden fields
    const forbidden = detectForbiddenFields(request.body);
    if (forbidden.length > 0) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: `Request body must not contain: ${forbidden.join(", ")}`,
      });
    }

    // 4. Validate body with zod (strict — rejects extra keys)
    const parsed = registrationBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: parsed.error.issues.map((i) => i.message).join("; "),
        details: parsed.error.issues,
      });
    }

    const { department, team } = parsed.data;

    // 5. Derive tier server-side — NEVER accept from client
    const tier = deriveTier(department);

    // 6. Check if member already has committed claims (active, pr_raised, merged) or PRs.
    // If they have begun participating, they cannot modify department/team (admin-only).
    const committedClaimsCount = await db.claim.count({
      where: {
        memberId: session.memberId,
        status: { in: ["active", "pr_raised", "merged"] },
      },
    });
    const prsCount = await db.pullRequest.count({
      where: { memberId: session.memberId },
    });

    if (committedClaimsCount > 0 || prsCount > 0) {
      if (session.member.department !== department || session.member.team !== team) {
        return reply.status(403).send({
          statusCode: 403,
          error: "Forbidden",
          message: "Department and team cannot be changed after making claims or submitting pull requests. Please contact an admin.",
        });
      }
    }

    const beforeSnapshot = {
      department: session.member.department,
      team: session.member.team,
      tier: session.member.tier,
    };

    // 7. Update member by session.memberId
    // This handles both initial registration and repeat submissions (idempotent update)
    const updated = await db.member.update({
      where: { id: session.memberId },
      data: {
        department,
        team,
        tier,
      },
    });

    // 8. Write AuditLog row
    await db.auditLog.create({
      data: {
        actorMemberId: session.memberId,
        actorIp: request.ip,
        action: "member_registered",
        targetType: "Member",
        targetId: session.memberId,
        beforeJson: JSON.stringify(beforeSnapshot),
        afterJson: JSON.stringify({ department: updated.department, team: updated.team, tier: updated.tier }),
      },
    });

    request.log.info(
      {
        memberId: session.memberId,
        githubLogin: session.member.githubLogin,
        department,
        team,
        tier,
      },
      "Registration completed"
    );

    return reply.status(200).send({
      statusCode: 200,
      message: "Registration complete",
      member: {
        department: updated.department,
        team: updated.team,
        tier: updated.tier,
      },
    });
  });
};
