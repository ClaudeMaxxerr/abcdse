/**
 * adminGuard.ts — Phase B5
 *
 * Admin authentication per CONTEXT.md § 9.8:
 *   - Allowlist of github_user_id values from environment variable ADMIN_GITHUB_USER_IDS
 *   - Checked server-side on EVERY admin request
 *   - Never a role field the client can influence, never a shared password
 *   - Every admin authentication check is logged
 */

import { FastifyRequest, FastifyReply } from "fastify";
import { config } from "../config.js";
import { resolveSession } from "./session.js";
import { readSessionToken } from "./requestHelpers.js";
import { prisma } from "../db.js";

export interface AdminGuardOptions {
  prismaClient?: typeof prisma;
}

/**
 * Fastify preHandler hook that:
 * 1. Resolves the session cookie
 * 2. Checks the session member's githubUserId against the ADMIN_GITHUB_USER_IDS allowlist
 * 3. Logs every check (success and failure) per CONTEXT.md § 9.8
 * 4. Returns 401 if not authenticated, 403 if authenticated but not admin
 *
 * This guard must be attached to every admin route.
 */
export function makeAdminGuard(db: typeof prisma = prisma) {
  return async function adminGuard(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const rawToken = readSessionToken(request);
    const session = await resolveSession(db, rawToken);

    if (!session) {
      request.log.warn(
        { url: request.url, ip: request.ip },
        "Admin auth: no valid session"
      );
      reply.status(401).send({
        statusCode: 401,
        error: "Unauthorized",
        message: "Authentication required",
      });
      return;
    }

    const githubUserId = BigInt(session.member.githubUserId);
    const isAdmin = config.ADMIN_GITHUB_USER_IDS.some((id) => id === githubUserId);

    // Log every admin auth attempt (success and failure)
    request.log.info(
      {
        actor: session.member.githubLogin,
        githubUserId: githubUserId.toString(),
        url: request.url,
        method: request.method,
        ip: request.ip,
        allowed: isAdmin,
      },
      `Admin auth check: ${isAdmin ? "ALLOWED" : "DENIED"}`
    );

    if (!isAdmin) {
      reply.status(403).send({
        statusCode: 403,
        error: "Forbidden",
        message: "Admin access required",
      });
      return;
    }

    // Attach session to request for downstream handlers
    (request as any).session = session;
  };
}
