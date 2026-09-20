/**
 * claimEngine.ts — Phase B3
 *
 * Implements the 8-step validation chain from CONTEXT.md Section 9.9.
 * Every acceptance path runs inside ONE database transaction that begins
 * with SELECT … FOR UPDATE on the Issue row so that concurrent claims
 * are serialised correctly.
 *
 * RULE CHAIN (in order, first failure stops processing):
 *   1. Edited-comment rejection          (9.4)
 *   2. Registration check                (9.9 step 2)
 *   3. Tier/level permission             (9.9 step 3)
 *   4. Easy limit (max 3 general, 0 tech)(9.9 step 4)
 *   5. 2-active-claims limit             (9.9 step 5)
 *   6. Previously-expired-on-this-issue  (9.9 step 6)
 *   7a. Spot available + same-team guard (9.9 step 7)
 *   7b. Spot full → waitlist             (9.9 step 8)
 */

import { PrismaClient, ClaimStatus, IssueLevel, Tier } from "@prisma/client";
import { config } from "../config.js";
import {
  ACTIVE_CLAIM_STATUSES,
  LIFETIME_EASY_CLAIM_STATUSES,
  COMMITTED_CLAIM_STATUSES,
  OCCUPIED_SPOT_CLAIM_STATUSES,
} from "./claimConstants.js";
import {
  getTierCap,
  computePotentialPoints,
  computeClaimsNeededToReachCap,
} from "./scoring.js";

export {
  ACTIVE_CLAIM_STATUSES,
  LIFETIME_EASY_CLAIM_STATUSES,
  COMMITTED_CLAIM_STATUSES,
  OCCUPIED_SPOT_CLAIM_STATUSES,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommentContext {
  /** GitHub numeric comment ID (BigInt) */
  commentId: bigint;
  /** GitHub numeric user ID of the commenter (BigInt) */
  githubUserId: bigint;
  /** Raw comment body as received from GitHub */
  body: string;
  /** ISO-8601 string from GitHub */
  createdAt: string;
  /** ISO-8601 string from GitHub – differs from createdAt if comment was edited */
  updatedAt: string;
}

export interface IssueContext {
  /** GitHub repo owner (e.g. "AARVAK-VSET") */
  repoOwner: string;
  /** GitHub repo name (e.g. "aqua-sense") */
  repoName: string;
  /** Issue number on GitHub */
  issueNumber: number;
}

export type ClaimEngineResult =
  | { outcome: "not_a_claim" }
  | { outcome: "bot_self_comment" }
  | { outcome: "already_processed" }
  | { outcome: "edited_rejected"; message: string }
  | { outcome: "not_registered"; message: string }
  | { outcome: "tier_forbidden"; message: string }
  | { outcome: "easy_limit"; message: string }
  | { outcome: "active_claims_limit"; message: string }
  | { outcome: "tier_cap_covered"; message: string }
  | { outcome: "previously_expired"; message: string }
  | { outcome: "same_team"; message: string }
  | { outcome: "accepted"; message: string; deadline: Date }
  | { outcome: "waitlisted"; message: string; position: number }
  | { outcome: "issue_not_found"; message: string };

export type UnclaimEngineResult =
  | { outcome: "not_an_unclaim" }
  | { outcome: "bot_self_comment" }
  | { outcome: "not_registered"; message: string }
  | { outcome: "no_active_claim"; message: string }
  | { outcome: "released"; message: string };

// ---------------------------------------------------------------------------
// Comment parsing
// ---------------------------------------------------------------------------

const CLAIM_TEXT = "claiming this issue";
const UNCLAIM_TEXT = "unclaiming this issue";

/**
 * Strips trailing punctuation then checks case-insensitive exact equality.
 * A body that CONTAINS the phrase as a substring is NOT accepted.
 */
export function parseClaimIntent(
  body: string
): "claim" | "unclaim" | null {
  const normalised = body.trim().replace(/[.,!?;:\s]+$/, "").toLowerCase();
  if (normalised === CLAIM_TEXT) return "claim";
  if (normalised === UNCLAIM_TEXT) return "unclaim";
  return null;
}

// ---------------------------------------------------------------------------
// Main: process a "created" issue_comment webhook event
// ---------------------------------------------------------------------------

export async function processClaimComment(
  db: PrismaClient,
  comment: CommentContext,
  issue: IssueContext,
  opts: {
    botUserId?: bigint;
    /** Called to post a reply on GitHub. Signature matches postBotComment but we decouple here. */
    postReply: (
      issueId: string,
      kind: string,
      body: string,
      memberId: string | null
    ) => Promise<void>;
  }
): Promise<ClaimEngineResult> {
  // ── Step 0: ignore self-comments ──────────────────────────────────────────
  if (opts.botUserId !== undefined && comment.githubUserId === opts.botUserId) {
    return { outcome: "bot_self_comment" };
  }

  // ── Parse comment body ────────────────────────────────────────────────────
  const intent = parseClaimIntent(comment.body);
  if (intent !== "claim") {
    // If they wrote something containing the phrase but not exactly matching it,
    // we post a helpful hint. We only do this when the body loosely contains the phrase.
    const lower = comment.body.toLowerCase();
    if (
      lower.includes("claiming this issue") ||
      lower.includes("claim this issue")
    ) {
      // Find issueId to post a comment (best-effort; if not found, skip)
      const dbIssue = await db.issue.findFirst({
        where: {
          number: issue.issueNumber,
          repo: { owner: issue.repoOwner, name: issue.repoName },
        },
        select: { id: true },
      });
      if (dbIssue) {
        const msg =
          `To claim this issue, your comment must be **exactly** (no other text):\n\`Claiming this issue\`\n\n` +
          `Your comment was not accepted because it contains extra text or punctuation.`;
        await opts.postReply(dbIssue.id, "claim_format_hint", msg, null);
      }
    }
    return { outcome: "not_a_claim" };
  }

  // ── Step 1: Edited-comment rejection (9.4) ────────────────────────────────
  if (comment.createdAt !== comment.updatedAt) {
    const dbIssue = await db.issue.findFirst({
      where: {
        number: issue.issueNumber,
        repo: { owner: issue.repoOwner, name: issue.repoName },
      },
      select: { id: true },
    });
    const msg =
      `❌ **Edited comments cannot be used to claim issues.** ` +
      `This comment was edited after it was posted (created: ${comment.createdAt}, updated: ${comment.updatedAt}), ` +
      `which would allow backdating a claim timestamp. ` +
      `Please post a **new** comment with exactly: \`Claiming this issue\``;
    if (dbIssue) {
      await opts.postReply(dbIssue.id, "claim_edited_rejected", msg, null);
    }
    return { outcome: "edited_rejected", message: msg };
  }

  // ── Run the database updates inside a serialised transaction ─────────────
  type TxResult =
    | { outcome: "issue_not_found"; message: string }
    | { outcome: "not_registered"; message: string; issueDbId: string }
    | { outcome: "tier_forbidden"; message: string; issueDbId: string; memberId: string }
    | { outcome: "easy_limit"; message: string; issueDbId: string; memberId: string }
    | { outcome: "active_claims_limit"; message: string; issueDbId: string; memberId: string }
    | { outcome: "tier_cap_covered"; message: string; issueDbId: string; memberId: string }
    | { outcome: "previously_expired"; message: string; issueDbId: string; memberId: string }
    | { outcome: "same_team"; message: string; issueDbId: string; memberId: string }
    | { outcome: "accepted"; message: string; deadline: Date; issueDbId: string; memberId: string }
    | { outcome: "waitlisted"; message: string; position: number; issueDbId: string; memberId: string };

  const txRes = await db.$transaction(
    async (tx): Promise<TxResult> => {
      // Lock the issue row first (SELECT … FOR UPDATE)
      const rows = await tx.$queryRaw<{ id: string; spots: number; level: IssueLevel }[]>`
        SELECT i.id, i.spots, i.level
        FROM "Issue" i
        JOIN "Repo" r ON r.id = i."repoId"
        WHERE r.owner = ${issue.repoOwner}
          AND r.name  = ${issue.repoName}
          AND i.number = ${issue.issueNumber}
        FOR UPDATE`;

      if (!rows[0]) {
        return {
          outcome: "issue_not_found",
          message: `Issue #${issue.issueNumber} in ${issue.repoOwner}/${issue.repoName} is not registered in the tracker.`,
        };
      }

      const dbIssue = rows[0];

      // ── Step 2: Registration check ──────────────────────────────────────
      const member = await tx.member.findUnique({
        where: { githubUserId: comment.githubUserId },
      });

      if (!member) {
        const msg =
          `❌ **You are not registered for Patch Wars 2026.** ` +
          `Please complete registration before claiming issues. ` +
          `Visit the tracker to sign up with your GitHub account.`;
        return { outcome: "not_registered", message: msg, issueDbId: dbIssue.id };
      }

      // ── Step 3: Tier/level permission ───────────────────────────────────
      const level = dbIssue.level;
      if (member.tier === Tier.tech && level === IssueLevel.easy) {
        const msg =
          `❌ **Technical department members may not claim Easy issues.** ` +
          `Your tier (\`tech\`) is restricted to Medium and Hard issues only. ` +
          `Please choose a Medium or Hard issue.`;
        return { outcome: "tier_forbidden", message: msg, issueDbId: dbIssue.id, memberId: member.id };
      }

      // ── Step 4: Easy limit (general: max 3, tech: 0 enforced above) ─────
      if (level === IssueLevel.easy) {
        const easyCount = await tx.claim.count({
          where: {
            memberId: member.id,
            status: { in: [...LIFETIME_EASY_CLAIM_STATUSES] },
            issue: { level: IssueLevel.easy },
          },
        });
        if (easyCount >= 3) {
          const msg =
            `❌ **Easy issue limit reached.** ` +
            `You have already used all 3 of your allowed Easy issue claims. ` +
            `You may only claim Medium or Hard issues now.`;
          return { outcome: "easy_limit", message: msg, issueDbId: dbIssue.id, memberId: member.id };
        }
      }

      // ── Step 5: 2-active-claims limit ───────────────────────────────────
      const activeClaims = await tx.claim.count({
        where: {
          memberId: member.id,
          status: { in: [...ACTIVE_CLAIM_STATUSES] },
        },
      });
      if (activeClaims >= 2) {
        const msg =
          `❌ **Active claim limit reached.** ` +
          `You already hold 2 active claims (issues with no PR raised yet). ` +
          `Raise a PR on one of your existing claims to free a slot, then claim again.`;
        return { outcome: "active_claims_limit", message: msg, issueDbId: dbIssue.id, memberId: member.id };
      }

      // ── Step 6: Tier cap potential claim-eligibility check ───────────────
      // Mid-event rule: Block a new claim when potentialPoints >= tierCap AND
      // the member already holds (claimsNeededToReachCap + 1) claims in active/pr_raised/merged.
      const tierCap = getTierCap(member.tier);
      const pullRequests = await tx.pullRequest.findMany({
        where: {
          memberId: member.id,
          countsForScore: true,
        },
        include: {
          issue: {
            select: { level: true },
          },
        },
        orderBy: { openedAt: "asc" },
      });

      const potentialPoints = computePotentialPoints(pullRequests);
      if (potentialPoints >= tierCap) {
        const claimsNeededToReachCap = computeClaimsNeededToReachCap(pullRequests, tierCap);
        const committedClaimsCount = await tx.claim.count({
          where: {
            memberId: member.id,
            status: { in: [...COMMITTED_CLAIM_STATUSES] },
          },
        });

        if (committedClaimsCount >= claimsNeededToReachCap + 1) {
          const msg =
            `❌ **Tier cap reached.** ` +
            `Your existing pull requests already cover your ${tierCap}-point cap. You cannot claim more issues. ` +
            `Focus on the ones you have — quality decides which PRs are merged.`;
          return { outcome: "tier_cap_covered", message: msg, issueDbId: dbIssue.id, memberId: member.id };
        }
      }

      // ── Step 7: Previously-expired-on-this-issue rejection ──────────────
      const expiredClaim = await tx.claim.findFirst({
        where: {
          memberId: member.id,
          issueId: dbIssue.id,
          status: ClaimStatus.expired,
        },
      });
      if (expiredClaim) {
        const msg =
          `❌ **You cannot re-claim this issue.** ` +
          `Your previous claim on this issue expired (deadline was ${expiredClaim.deadline.toISOString()}). ` +
          `Per competition rules, a member whose claim expired may not re-claim the same issue.`;
        return { outcome: "previously_expired", message: msg, issueDbId: dbIssue.id, memberId: member.id };
      }

      // ── Count occupied spots INSIDE the lock ────────────────────────────
      const occupiedClaims = await tx.claim.findMany({
        where: {
          issueId: dbIssue.id,
          status: { in: [...OCCUPIED_SPOT_CLAIM_STATUSES] },
        },
        include: { member: { select: { team: true, id: true } } },
      });

      const spotsOccupied = occupiedClaims.length;
      const totalSpots = dbIssue.spots;

      if (spotsOccupied < totalSpots) {
        // ── Step 7a: Spot available — same-team check for Medium/Hard ────
        if (level !== IssueLevel.easy) {
          const sameTeamClaim = occupiedClaims.find(
            (c) => c.member.team === member.team
          );
          if (sameTeamClaim) {
            const msg =
              `❌ **Same-team restriction.** ` +
              `This ${level} issue already has a claimer from your team (${member.team}). ` +
              `Medium and Hard issues must be claimed by members from different teams. ` +
              `Please choose a different issue.`;
            return { outcome: "same_team", message: msg, issueDbId: dbIssue.id, memberId: member.id };
          }
        }

        // ── Accept: set deadline = comment.created_at + TTL hours ────────
        const claimedAt = new Date(comment.createdAt);
        const deadline = new Date(claimedAt.getTime() + config.CLAIM_TTL_HOURS * 60 * 60 * 1000);

        await tx.claim.create({
          data: {
            memberId: member.id,
            issueId: dbIssue.id,
            commentId: comment.commentId,
            claimedAt,
            deadline,
            status: ClaimStatus.active,
          },
        });

        const msg =
          `✅ **Claim accepted!** @${member.githubLogin}, you have claimed this ${level} issue. ` +
          `You have **${config.CLAIM_TTL_HOURS} hours** to raise a Pull Request — your deadline is **${deadline.toUTCString()}**. ` +
          `Mention \`#${issue.issueNumber}\` in your PR description (e.g. \`Fixes #${issue.issueNumber}\`).`;
        return { outcome: "accepted", message: msg, deadline, issueDbId: dbIssue.id, memberId: member.id };
      } else {
        // ── Step 8: No spots remain → waitlist ───────────────────────────
        const existingWaitlist = await tx.waitlistEntry.findFirst({
          where: { memberId: member.id, issueId: dbIssue.id, resolvedAt: null },
        });
        if (existingWaitlist) {
          const msg =
            `ℹ️ You are already on the waiting list for this issue at position **${existingWaitlist.position}**.`;
          return { outcome: "waitlisted", message: msg, position: existingWaitlist.position, issueDbId: dbIssue.id, memberId: member.id };
        }

        // Compute position: count of existing unresolved waitlist entries + 1
        const currentQueueLength = await tx.waitlistEntry.count({
          where: { issueId: dbIssue.id, resolvedAt: null },
        });
        const position = currentQueueLength + 1;

        await tx.waitlistEntry.create({
          data: {
            memberId: member.id,
            issueId: dbIssue.id,
            commentId: comment.commentId,
            queuedAt: new Date(comment.createdAt),
            position,
          },
        });

        const msg =
          `📋 **This issue is full, but you have been added to the waiting list** at position **${position}**. ` +
          `If a spot becomes available, you will be notified and given ${config.CLAIM_TTL_HOURS} hours to raise a PR.`;
        return { outcome: "waitlisted", message: msg, position, issueDbId: dbIssue.id, memberId: member.id };
      }
    },
    { timeout: 60_000, maxWait: 60_000 }
  );

  // ── Post reply outside the transaction (prevents pooler lockups) ──────────
  if ("issueDbId" in txRes) {
    const kindMap: Record<string, string> = {
      active_claims_limit: "claim_active_limit",
      tier_cap_covered: "claim_tier_cap_covered",
    };
    const kind = kindMap[txRes.outcome] || `claim_${txRes.outcome}`;
    const memberId = "memberId" in txRes ? txRes.memberId : null;
    await opts.postReply(txRes.issueDbId, kind, txRes.message, memberId);
  }

  if (txRes.outcome === "accepted") {
    return { outcome: "accepted", message: txRes.message, deadline: txRes.deadline };
  }
  if (txRes.outcome === "waitlisted") {
    return { outcome: "waitlisted", message: txRes.message, position: txRes.position };
  }
  return { outcome: txRes.outcome, message: txRes.message };
}

// ---------------------------------------------------------------------------
// Unclaim
// ---------------------------------------------------------------------------

export async function processUnclaimComment(
  db: PrismaClient,
  comment: CommentContext,
  issue: IssueContext,
  opts: {
    botUserId?: bigint;
    postReply: (
      issueId: string,
      kind: string,
      body: string,
      memberId: string | null
    ) => Promise<void>;
  }
): Promise<UnclaimEngineResult> {
  // Ignore self-comments
  if (opts.botUserId !== undefined && comment.githubUserId === opts.botUserId) {
    return { outcome: "bot_self_comment" };
  }

  const intent = parseClaimIntent(comment.body);
  if (intent !== "unclaim") {
    return { outcome: "not_an_unclaim" };
  }

  const txRes = await db.$transaction(async (tx) => {
    // Lock the issue row
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT i.id
      FROM "Issue" i
      JOIN "Repo" r ON r.id = i."repoId"
      WHERE r.owner = ${issue.repoOwner}
        AND r.name  = ${issue.repoName}
        AND i.number = ${issue.issueNumber}
      FOR UPDATE`;

    if (!rows[0]) {
      return {
        outcome: "no_active_claim" as const,
        message: "Issue not found in tracker.",
      };
    }
    const issueId = rows[0].id;

    const member = await tx.member.findUnique({
      where: { githubUserId: comment.githubUserId },
    });
    if (!member) {
      const msg = `❌ You are not registered for Patch Wars 2026.`;
      return { outcome: "not_registered" as const, message: msg, issueId, memberId: null };
    }

    const activeClaim = await tx.claim.findFirst({
      where: {
        memberId: member.id,
        issueId,
        status: { in: [...ACTIVE_CLAIM_STATUSES] },
      },
    });

    if (!activeClaim) {
      const msg = `❌ You do not have an active claim on this issue to release.`;
      return { outcome: "no_active_claim" as const, message: msg, issueId, memberId: member.id };
    }

    // Mark released (no penalty)
    await tx.claim.update({
      where: { id: activeClaim.id },
      data: { status: ClaimStatus.released },
    });

    // Promote waitlist head atomically
    await promoteWaitlistHead(issueId, tx);

    const msg = `🔓 @${member.githubLogin} has released their claim on this issue. The spot is now available.`;
    return { outcome: "released" as const, message: msg, issueId, memberId: member.id };
  }, { timeout: 60_000, maxWait: 60_000 });

  if ("issueId" in txRes && txRes.issueId) {
    const kind = txRes.outcome === "released" ? "claim_released" : `unclaim_${txRes.outcome}`;
    await opts.postReply(txRes.issueId, kind, txRes.message, txRes.memberId ?? null);
  }

  return { outcome: txRes.outcome, message: txRes.message };
}

// ---------------------------------------------------------------------------
// Waitlist promotion helper (used by unclaim and expiry sweep)
// ---------------------------------------------------------------------------

/**
 * Promotes the head of the waiting list (lowest position with resolvedAt = null)
 * to an active claim. Sets a fresh 48-hour deadline from NOW.
 * MUST be called inside an existing transaction.
 */
export async function promoteWaitlistHead(
  issueId: string,
  tx: Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">
): Promise<{ promoted: boolean; memberId?: string; deadline?: Date }> {
  const head = await tx.waitlistEntry.findFirst({
    where: { issueId, resolvedAt: null },
    orderBy: [{ position: "asc" }],
    include: { member: { select: { id: true, githubLogin: true } } },
  });

  if (!head) return { promoted: false };

  const now = new Date();
  const deadline = new Date(now.getTime() + config.CLAIM_TTL_HOURS * 60 * 60 * 1000);

  // Mark the waitlist entry as resolved
  await tx.waitlistEntry.update({
    where: { id: head.id },
    data: { resolvedAt: now },
  });

  // Create an active claim for the promoted member
  await tx.claim.upsert({
    where: { memberId_issueId: { memberId: head.memberId, issueId } },
    create: {
      memberId: head.memberId,
      issueId,
      commentId: head.commentId,
      claimedAt: now,
      deadline,
      promotedAt: now,
      status: ClaimStatus.active,
    },
    update: {
      status: ClaimStatus.active,
      deadline,
      promotedAt: now,
    },
  });

  return { promoted: true, memberId: head.memberId, deadline };
}
