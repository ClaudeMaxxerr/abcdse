/**
 * session.ts — Phase B5
 *
 * Server-side session management per CONTEXT.md § 9.8:
 *   - Random raw token → only SHA-256 hash stored in DB (revocable, no plaintext in DB)
 *   - Absolute 7-day expiry
 *   - Sessions can be revoked immediately (revokedAt != null → rejected)
 *   - No JWT in localStorage
 */

import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

export const SESSION_COOKIE_NAME = "pw_sid";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days absolute expiry

/**
 * SHA-256 hash of the raw session token.
 * Only the hash is stored in the database; the raw token lives in the cookie only.
 */
export function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/**
 * Creates a new session for a member.
 * Returns the raw token to be set in the cookie.
 * Only the hash is written to the database.
 */
export async function createSession(
  db: PrismaClient | any,
  memberId: string,
  ip: string,
  userAgent: string | undefined
): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.session.create({
    data: {
      memberId,
      tokenHash,
      expiresAt,
      ip,
      userAgent: userAgent ?? null,
    },
  });

  return rawToken;
}

export interface ResolvedSession {
  sessionId: string;
  memberId: string;
  tokenHash: string;
  expiresAt: Date;
  member: {
    id: string;
    githubUserId: bigint;
    githubLogin: string;
    displayName: string;
    department: string;
    team: string;
    tier: string;
    isAdmin: boolean;
  };
}

/**
 * Resolves a raw session token to a session.
 * Returns null if the token is missing, not found, revoked, or expired.
 * This is the ONLY place sessions are validated; never trust client-supplied role fields.
 */
export async function resolveSession(
  db: PrismaClient | any,
  rawToken: string | undefined
): Promise<ResolvedSession | null> {
  if (!rawToken) return null;

  const tokenHash = hashToken(rawToken);

  const session = await db.session.findUnique({
    where: { tokenHash },
    include: {
      member: {
        select: {
          id: true,
          githubUserId: true,
          githubLogin: true,
          displayName: true,
          department: true,
          team: true,
          tier: true,
          isAdmin: true,
        },
      },
    },
  });

  if (!session) return null;
  if (session.revokedAt !== null) return null;
  if (session.expiresAt < new Date()) return null;

  return {
    sessionId: session.id,
    memberId: session.memberId,
    tokenHash: session.tokenHash,
    expiresAt: session.expiresAt,
    member: session.member,
  };
}

/**
 * Revokes a session immediately by setting revokedAt.
 * Subsequent resolveSession calls with the same token will return null.
 */
export async function revokeSession(
  db: PrismaClient | any,
  tokenHash: string
): Promise<void> {
  await db.session.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
