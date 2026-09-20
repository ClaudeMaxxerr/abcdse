/**
 * claimConstants.ts
 *
 * Central definition of named claim status sets per CONTEXT.md §§ 2.4, 2.5, 9.9:
 *
 * 1. ACTIVE_CLAIM_STATUSES:
 *    Claims currently consuming a member's active concurrency slot (max 2).
 *    Only status = 'active' consumes a slot. Once a PR is opened ('pr_raised'),
 *    the slot is freed so the member can claim another issue.
 *
 * 2. LIFETIME_EASY_CLAIM_STATUSES:
 *    Claims that count against the lifetime limit of 3 Easy issues for General tier.
 *    Includes 'active', 'pr_raised', and 'merged'.
 *
 * 3. COMMITTED_CLAIM_STATUSES:
 *    Claims representing committed work by a member.
 *    Holding any committed claims (or PRs) locks department/team self-correction.
 *
 * 4. OCCUPIED_SPOT_CLAIM_STATUSES:
 *    Claims that occupy an issue's available spots (spotsTotal).
 *    Includes 'active' and 'pr_raised'.
 */

import { ClaimStatus } from "@prisma/client";

/** Claims consuming active concurrency slots (max 2 active claims per member) */
export const ACTIVE_CLAIM_STATUSES: readonly ClaimStatus[] = [
  ClaimStatus.active,
] as const;

/** Claims counting towards the lifetime limit of 3 Easy claims (General tier) */
export const LIFETIME_EASY_CLAIM_STATUSES: readonly ClaimStatus[] = [
  ClaimStatus.active,
  ClaimStatus.pr_raised,
  ClaimStatus.merged,
] as const;

/** Claims counting towards the lifetime limit of 2 Hard claims (General tier) */
export const LIFETIME_HARD_CLAIM_STATUSES: readonly ClaimStatus[] = [
  ClaimStatus.active,
  ClaimStatus.pr_raised,
  ClaimStatus.merged,
] as const;

/** Claims representing committed work that lock department/team editing */
export const COMMITTED_CLAIM_STATUSES: readonly ClaimStatus[] = [
  ClaimStatus.active,
  ClaimStatus.pr_raised,
  ClaimStatus.merged,
] as const;

/** Claims that occupy a spot on an issue */
export const OCCUPIED_SPOT_CLAIM_STATUSES: readonly ClaimStatus[] = [
  ClaimStatus.active,
  ClaimStatus.pr_raised,
] as const;
