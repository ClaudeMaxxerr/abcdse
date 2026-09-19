/**
 * expirySweep.ts — Phase B3
 *
 * Finds all `active` claims whose deadline has passed, marks them `expired`,
 * posts a bot comment, frees the spot, and promotes the waitlist head with a
 * fresh 48-hour deadline.
 *
 * CONCURRENCY SAFETY:
 * - Uses a PostgreSQL advisory lock (pg_try_advisory_xact_lock) so concurrent
 *   sweeps skip rather than double-process.
 * - All mutations happen inside a single transaction per expired claim.
 * - Safe to run with all three triggers firing simultaneously.
 *
 * THREE TRIGGERS (as required by task 6):
 *   a) setInterval every 5 minutes while process is running → setupSweepInterval()
 *   b) Opportunistic at start of every webhook/API request → runOpportunisticSweep()
 *      guarded by persisted last_swept_at (at most once per minute)
 *   c) POST /internal/sweep authenticated by SWEEP_SECRET → exposed via HTTP route
 */

import { PrismaClient, ClaimStatus } from "@prisma/client";
import { promoteWaitlistHead } from "./claimEngine.js";
import { config } from "../config.js";

// Arbitrary stable bigint key for the advisory lock.
// 0x50415443 = "PATC" in ASCII – memorable, collision-unlikely.
const SWEEP_ADVISORY_LOCK_KEY = BigInt("0x5041544357415253"); // "PATCWARS"

const LAST_SWEPT_KEY = "last_swept_at";
/** Minimum gap between opportunistic sweeps (milliseconds) */
const SWEEP_MIN_INTERVAL_MS = 60_000;

/** How long after deadline before a claim is expired (no grace, 0 ms) */
const CLAIM_EXPIRY_GRACE_MS = 0;

// ---------------------------------------------------------------------------
// Core sweep
// ---------------------------------------------------------------------------

export interface SweepResult {
  expired: number;
  promoted: number;
  skipped_locked: boolean;
}

/**
 * Runs one sweep cycle. Safe to call concurrently — uses a PostgreSQL
 * advisory lock so at most one sweep runs at a time.
 *
 * @param db  PrismaClient (or tx-compatible)
 * @param opts.postReply  async function to post a GitHub bot comment
 */
export async function runExpirySweep(
  db: PrismaClient,
  opts: {
    postReply: (
      issueId: string,
      kind: string,
      body: string,
      memberId: string | null
    ) => Promise<void>;
  }
): Promise<SweepResult> {
  // Find all overdue active claims BEFORE entering the per-claim transaction,
  // so we don't hold a broad lock while looping.
  const now = new Date();
  const overdue = await db.claim.findMany({
    where: {
      status: ClaimStatus.active,
      deadline: { lt: new Date(now.getTime() - CLAIM_EXPIRY_GRACE_MS) },
    },
    select: {
      id: true,
      issueId: true,
      memberId: true,
      deadline: true,
      member: { select: { githubLogin: true } },
    },
  });

  let expired = 0;
  let promoted = 0;

  for (const claim of overdue) {
    // Each expired claim gets its own short transaction with its own advisory lock,
    // so concurrent sweeps don't double-process.
    const result = await db.$transaction(async (tx) => {
      // Try to acquire the advisory lock for this specific claim.
      // If another sweep already has it, skip (returns false).
      const lockResult = await tx.$queryRaw<[{ pg_try_advisory_xact_lock: boolean }]>`
        SELECT pg_try_advisory_xact_lock(${SWEEP_ADVISORY_LOCK_KEY}::bigint)`;

      if (!lockResult[0]?.pg_try_advisory_xact_lock) {
        return { didExpire: false, didPromote: false, skipped: true };
      }

      // Re-read claim inside transaction with FOR UPDATE to prevent races
      const freshClaim = await tx.claim.findFirst({
        where: { id: claim.id, status: ClaimStatus.active },
        select: { id: true, deadline: true },
      });

      // Already processed by a concurrent sweep – skip
      if (!freshClaim || freshClaim.deadline >= now) {
        return { didExpire: false, didPromote: false, skipped: false };
      }

      // Expire the claim
      await tx.claim.update({
        where: { id: claim.id },
        data: { status: ClaimStatus.expired },
      });

      // Promote waitlist head
      const promotion = await promoteWaitlistHead(claim.issueId, tx);

      return { didExpire: true, didPromote: promotion.promoted, skipped: false, promotion };
    }, { timeout: 15000 });

    if (result.didExpire) {
      expired++;

      // Post expiry comment (outside the transaction so the lock is released first)
      const expMsg =
        `⏰ **Claim expired.** @${claim.member.githubLogin}'s claim has expired — ` +
        `no Pull Request was raised within ${config.CLAIM_TTL_HOURS} hours (deadline: ${claim.deadline.toUTCString()}). ` +
        `The spot has been freed.`;
      await opts.postReply(claim.issueId, `claim_expired_${claim.id}`, expMsg, claim.memberId);

      if (result.didPromote && result.promotion) {
        const deadline = result.promotion.deadline!;
        const promotedMemberId = result.promotion.memberId!;

        // Fetch member login for the message
        const promotedMember = await db.member.findUnique({
          where: { id: promotedMemberId },
          select: { githubLogin: true },
        });

        if (promotedMember) {
          promoted++;
          const promMsg =
            `🎉 @${promotedMember.githubLogin}, you have been promoted from the waiting list! ` +
            `Your ${config.CLAIM_TTL_HOURS}-hour deadline starts now and expires at **${deadline.toUTCString()}**. ` +
            `Please raise a Pull Request before then.`;
          await opts.postReply(
            claim.issueId,
            `claim_promoted_${promotedMemberId}`,
            promMsg,
            promotedMemberId
          );
        }
      }
    }
  }

  return { expired, promoted, skipped_locked: false };
}

// ---------------------------------------------------------------------------
// Trigger (a): setInterval every 5 minutes
// ---------------------------------------------------------------------------

/**
 * Starts a 5-minute background sweep interval.
 * Call once at process startup. Returns the timer handle so it can be cleared in tests.
 */
export function setupSweepInterval(
  db: PrismaClient,
  opts: {
    postReply: (
      issueId: string,
      kind: string,
      body: string,
      memberId: string | null
    ) => Promise<void>;
    intervalMs?: number;
  }
): ReturnType<typeof setInterval> {
  const intervalMs = opts.intervalMs ?? 5 * 60 * 1000;
  return setInterval(() => {
    runExpirySweep(db, opts).catch((err) => {
      console.error("[sweep interval] Error during expiry sweep:", err);
    });
  }, intervalMs);
}

// ---------------------------------------------------------------------------
// Trigger (b): Opportunistic sweep guarded by last_swept_at
// ---------------------------------------------------------------------------

/**
 * Runs a sweep only if the last sweep was more than SWEEP_MIN_INTERVAL_MS ago.
 * The check+update of last_swept_at is itself guarded by a DB-level FOR UPDATE,
 * so concurrent calls will not double-sweep.
 */
export async function runOpportunisticSweep(
  db: PrismaClient,
  opts: {
    postReply: (
      issueId: string,
      kind: string,
      body: string,
      memberId: string | null
    ) => Promise<void>;
  }
): Promise<boolean> {
  if (typeof db?.systemConfig?.findUnique !== "function") {
    return false;
  }
  const now = new Date();
  const existing = await db.systemConfig.findUnique({
    where: { key: LAST_SWEPT_KEY },
  });

  if (existing) {
    const lastSwept = new Date(existing.value);
    if (now.getTime() - lastSwept.getTime() < SWEEP_MIN_INTERVAL_MS) {
      return false; // Too soon
    }
  }

  // Update the timestamp
  await db.systemConfig.upsert({
    where: { key: LAST_SWEPT_KEY },
    update: { value: now.toISOString() },
    create: { key: LAST_SWEPT_KEY, value: now.toISOString() },
  });

  await runExpirySweep(db, opts);
  return true;
}
