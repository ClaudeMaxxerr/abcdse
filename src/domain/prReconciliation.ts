/**
 * prReconciliation.ts
 *
 * Periodic background job that lists all pull requests (open, closed, merged) across all
 * registered repos via the GitHub API, reconciling missing PR records, populating real
 * githubPrIds, and accurately synchronizing merge states.
 *
 * Ensures lost opened and closed webhook deliveries self-heal automatically and idempotently.
 */

import { PrismaClient, ClaimStatus } from "@prisma/client";
import { GitHubApiClient } from "../github/client.js";
import { GitHubAppTokenManager } from "../github/auth.js";
import { config } from "../config.js";
import { processPullRequestOpened, PullRequestContext, RepoContext } from "./prEngine.js";
import { postBotComment, postBotCommentOnPr } from "../github/comments.js";

export interface ReconciliationOptions {
  prismaClient?: PrismaClient | any;
  githubClient?: GitHubApiClient;
  postReply?: (issueId: string, kind: string, body: string, memberId: string | null) => Promise<void>;
  postPrReply?: (owner: string, repo: string, prNumber: number, kind: string, body: string, memberId: string | null) => Promise<void>;
  finalDeadline?: Date;
}

export interface PRChangeRecord {
  repo: string;
  prNumber: number;
  issueNumber?: number;
  author: string;
  action: "linked" | "merge_status_corrected" | "github_id_backfilled";
  before: {
    merged?: boolean;
    countsForScore?: boolean;
    githubPrId?: string;
  };
  after: {
    merged?: boolean;
    countsForScore?: boolean;
    githubPrId?: string;
  };
}

export interface ReconciliationResult {
  recoveredCount: number;
  updatedMergeCount: number;
  totalOpenPrs: number;
  totalProcessedPrs: number;
  reconciledPrs: Array<{
    repo: string;
    prNumber: number;
    outcome: string;
    title: string;
    author: string;
  }>;
  changedRows: PRChangeRecord[];
}

export interface GitHubPRSummary {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  isMerged: boolean;
  closedAt: Date | null;
  createdAt: string;
  login: string;
}

let sharedApiClient: GitHubApiClient | null = null;

function getOrCreateGitHubClient(): GitHubApiClient | null {
  if (sharedApiClient) return sharedApiClient;

  if (config.GITHUB_APP_ID && config.GITHUB_APP_PRIVATE_KEY && !config.BOT_DRY_RUN) {
    try {
      const privateKey = config.GITHUB_APP_PRIVATE_KEY.includes("\\n")
        ? config.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n")
        : config.GITHUB_APP_PRIVATE_KEY;

      const tokenManager = new GitHubAppTokenManager({
        appId: config.GITHUB_APP_ID,
        privateKey,
        installationId: config.GITHUB_APP_INSTALLATION_ID || "163014815",
      });
      sharedApiClient = new GitHubApiClient({ tokenManager });
      return sharedApiClient;
    } catch (err) {
      console.error("[prReconciliation] Failed to initialize GitHubApiClient:", err);
      return null;
    }
  }
  return null;
}

/**
 * Reconciles the merge state of pull requests in the database against GitHub API.
 *  - For PRs merged on GitHub (merged_at != null) with DB merged=false:
 *      Sets merged=true, closedAt, claim.status=merged, drops any other PR on the issue to merged=false,
 *      and honours FINAL_DEADLINE zero-score rule.
 *  - For the reverse (DB merged=true but GitHub not merged):
 *      Corrects DB merged=false and demotes claim.
 *  - Idempotent: rows already in agreement are untouched.
 */
export async function reconcileMergeState(
  db: PrismaClient | any,
  opts: ReconciliationOptions = {},
  prefetchedGhMap?: Map<string, GitHubPRSummary>
): Promise<{
  updatedCount: number;
  changedRows: PRChangeRecord[];
}> {
  const client = opts.githubClient ?? getOrCreateGitHubClient();
  const finalDeadline = opts.finalDeadline ?? config.FINAL_DEADLINE;

  const result = {
    updatedCount: 0,
    changedRows: [] as PRChangeRecord[],
  };

  let ghMap = prefetchedGhMap;
  if (!ghMap) {
    ghMap = new Map<string, GitHubPRSummary>();
    if (client) {
      const repos = await db.repo.findMany();
      for (const repo of repos) {
        try {
          const pulls = client.listAllPullRequests
            ? await client.listAllPullRequests(repo.owner, repo.name)
            : await (client.listPullRequests ? client.listPullRequests(repo.owner, repo.name, "all") : client.listOpenPullRequests(repo.owner, repo.name));
          for (const pull of pulls) {
            const isMerged = (pull.merged_at != null) || ((pull as any).merged === true);
            const closedAt = pull.closed_at ? new Date(pull.closed_at) : (pull.merged_at ? new Date(pull.merged_at) : null);
            ghMap.set(`${repo.id}:${pull.number}`, {
              id: pull.id,
              number: pull.number,
              title: pull.title || "",
              body: pull.body ?? null,
              state: pull.state ?? "open",
              isMerged,
              closedAt,
              createdAt: pull.created_at,
              login: pull.user?.login || "",
            });
          }
        } catch (err) {
          console.error(`[reconcileMergeState] Failed to fetch PRs for ${repo.owner}/${repo.name}:`, err);
        }
      }
    }
  }

  // Fetch all issues that have pull requests linked
  const issuesWithPrs = await db.issue.findMany({
    where: {
      pullRequests: {
        some: { countsForScore: true },
      },
    },
    include: {
      repo: true,
      pullRequests: {
        where: { countsForScore: true },
        include: { member: true, repo: true },
      },
      claims: true,
    },
  });

  for (const issue of issuesWithPrs) {
    const prs = issue.pullRequests;
    if (!prs || prs.length === 0) continue;

    // Check GitHub status for each PR
    const prInfoList = prs.map((pr: any) => {
      const ghInfo = ghMap?.get(`${pr.repoId}:${pr.number}`);
      const isMergedOnGitHub = ghInfo ? ghInfo.isMerged : pr.merged;
      const closedAt = ghInfo?.closedAt ?? (pr.closedAt ? new Date(pr.closedAt) : null);
      return {
        pr,
        isMergedOnGitHub,
        closedAt,
      };
    });

    const mergedPrsOnGh = prInfoList.filter((p: any) => p.isMergedOnGitHub);

    // Rule 2 & 4: If multiple PRs are merged on GitHub for the same issue
    if (mergedPrsOnGh.length > 1) {
      const hasLocked = prInfoList.some((p: any) => p.pr.mergeDecisionLocked);
      if (hasLocked) {
        // A row is locked by organiser decision:
        // Must NEVER change merged or countsForScore on locked row, and must never demote competing PRs.
        for (const item of prInfoList) {
          const pr = item.pr;
          const closedAtDate = item.closedAt ?? pr.closedAt;
          if (!pr.closedAt && closedAtDate) {
            await db.pullRequest.update({
              where: { id: pr.id },
              data: { closedAt: closedAtDate },
            });
          }
        }
        continue;
      }

      // Neither is locked: do NOT pick a winner by timestamp.
      // Leave existing DB state unchanged and log an admin-visible warning.
      console.warn(
        `[reconcileMergeState] CONFLICT: Multiple PRs merged on GitHub for issue #${issue.number} (${issue.repo.owner}/${issue.repo.name}) without locked organiser decision: ${mergedPrsOnGh
          .map((p: any) => `PR #${p.pr.number} by ${p.pr.member.githubLogin}`)
          .join(", ")}. Leaving DB state unchanged pending organiser decision.`
      );

      for (const item of prInfoList) {
        const pr = item.pr;
        const closedAtDate = item.closedAt ?? pr.closedAt;
        if (!pr.closedAt && closedAtDate) {
          await db.pullRequest.update({
            where: { id: pr.id },
            data: { closedAt: closedAtDate },
          });
        }
      }
      continue;
    }

    if (mergedPrsOnGh.length === 1) {
      const mergedItem = mergedPrsOnGh[0]!;
      const mergedPr = mergedItem.pr;

      // If the merged PR is locked, respect it and do not demote others
      if (mergedPr.mergeDecisionLocked) {
        if (!mergedPr.closedAt && mergedItem.closedAt) {
          await db.pullRequest.update({
            where: { id: mergedPr.id },
            data: { closedAt: mergedItem.closedAt },
          });
        }
        continue;
      }

      // If any other PR on the issue is locked, do not modify or demote
      const anyLocked = prInfoList.some((p: any) => p.pr.mergeDecisionLocked);
      if (anyLocked) {
        continue;
      }

      const closedAtDate = mergedItem.closedAt ?? mergedPr.closedAt ?? new Date();
      let countsForScore = mergedPr.countsForScore;
      if (finalDeadline && closedAtDate > finalDeadline) {
        countsForScore = false;
      }

      const wasMerged = mergedPr.merged;
      const hadCounts = mergedPr.countsForScore;

      if (!mergedPr.merged || mergedPr.countsForScore !== countsForScore || (!mergedPr.closedAt && closedAtDate)) {
        await db.pullRequest.update({
          where: { id: mergedPr.id },
          data: {
            merged: true,
            closedAt: closedAtDate,
            countsForScore,
          },
        });

        result.updatedCount++;
        result.changedRows.push({
          repo: `${mergedPr.repo.owner}/${mergedPr.repo.name}`,
          prNumber: mergedPr.number,
          issueNumber: issue.number,
          author: mergedPr.member.githubLogin,
          action: "merge_status_corrected",
          before: {
            merged: wasMerged,
            countsForScore: hadCounts,
          },
          after: {
            merged: true,
            countsForScore,
          },
        });
      }

      // Update corresponding claim status
      if (countsForScore) {
        await db.claim.updateMany({
          where: {
            issueId: issue.id,
            memberId: mergedPr.memberId,
          },
          data: {
            status: ClaimStatus.merged,
          },
        });
      }

      // Demote competing unlocked PRs on the same issue
      for (const otherItem of prInfoList) {
        const otherPr = otherItem.pr;
        if (otherPr.id === mergedPr.id || otherPr.mergeDecisionLocked) continue;

        if (otherPr.merged) {
          await db.pullRequest.update({
            where: { id: otherPr.id },
            data: { merged: false },
          });

          await db.claim.updateMany({
            where: {
              issueId: issue.id,
              memberId: otherPr.memberId,
              status: ClaimStatus.merged,
            },
            data: {
              status: ClaimStatus.pr_raised,
            },
          });

          result.updatedCount++;
          result.changedRows.push({
            repo: `${otherPr.repo.owner}/${otherPr.repo.name}`,
            prNumber: otherPr.number,
            issueNumber: issue.number,
            author: otherPr.member.githubLogin,
            action: "merge_status_corrected",
            before: { merged: true },
            after: { merged: false },
          });
        }
      }
      continue;
    }

    // None merged on GitHub: correct reverse case if DB had merged=true and row is not locked
    for (const item of prInfoList) {
      const pr = item.pr;
      if (pr.mergeDecisionLocked) continue;

      if (pr.merged) {
        await db.pullRequest.update({
          where: { id: pr.id },
          data: { merged: false },
        });

        // Demote claim from merged to pr_raised if needed
        await db.claim.updateMany({
          where: {
            issueId: issue.id,
            memberId: pr.memberId,
            status: ClaimStatus.merged,
          },
          data: {
            status: ClaimStatus.pr_raised,
          },
        });

        result.updatedCount++;
        result.changedRows.push({
          repo: `${pr.repo.owner}/${pr.repo.name}`,
          prNumber: pr.number,
          issueNumber: issue.number,
          author: pr.member.githubLogin,
          action: "merge_status_corrected",
          before: { merged: true },
          after: { merged: false },
        });
      }
    }
  }

  return result;
}

export async function runPrReconciliation(
  db: PrismaClient | any,
  opts: ReconciliationOptions = {}
): Promise<ReconciliationResult> {
  const client = opts.githubClient ?? getOrCreateGitHubClient();
  const postReply =
    opts.postReply ??
    (async (issueId: string, kind: string, body: string, memberId: string | null) => {
      await postBotComment(issueId, kind, body, memberId, { prismaClient: db });
    });
  const postPrReply =
    opts.postPrReply ??
    (async (owner: string, repo: string, prNumber: number, kind: string, body: string, memberId: string | null) => {
      await postBotCommentOnPr(owner, repo, prNumber, kind, body, memberId, { prismaClient: db });
    });

  const result: ReconciliationResult = {
    recoveredCount: 0,
    updatedMergeCount: 0,
    totalOpenPrs: 0,
    totalProcessedPrs: 0,
    reconciledPrs: [],
    changedRows: [],
  };

  if (!client) {
    return result;
  }

  // 1. Fetch all repos registered in DB
  const repos = await db.repo.findMany();

  // Map to store GitHub PR info per (repoId:prNumber)
  const ghPrMap = new Map<string, GitHubPRSummary>();

  for (const repo of repos) {
    try {
      // Use listAllPullRequests with state=all and pagination
      const allPulls = client.listAllPullRequests
        ? await client.listAllPullRequests(repo.owner, repo.name)
        : await (client.listPullRequests ? client.listPullRequests(repo.owner, repo.name, "all") : client.listOpenPullRequests(repo.owner, repo.name));
      result.totalProcessedPrs += allPulls.length;

      for (const pull of allPulls) {
        if (pull.state === "open") {
          result.totalOpenPrs++;
        }

        const isMerged = (pull.merged_at != null) || ((pull as any).merged === true);
        const closedAt = pull.closed_at ? new Date(pull.closed_at) : (pull.merged_at ? new Date(pull.merged_at) : null);
        const key = `${repo.id}:${pull.number}`;

        ghPrMap.set(key, {
          id: pull.id,
          number: pull.number,
          title: pull.title || "",
          body: pull.body ?? null,
          state: pull.state ?? "open",
          isMerged,
          closedAt,
          createdAt: pull.created_at,
          login: pull.user?.login || "",
        });

        // Check if PR already exists in DB
        let existingPr = await db.pullRequest.findFirst({
          where: {
            repoId: repo.id,
            number: pull.number,
          },
          include: {
            issue: {
              include: {
                claims: {
                  where: { status: { in: [ClaimStatus.active, ClaimStatus.pr_raised, ClaimStatus.merged] } },
                },
              },
            },
            member: true,
          },
        });

        // If PR does not exist or is unlinked, process it through PR engine
        if (!existingPr) {
          const prCtx: PullRequestContext = {
            id: pull.id,
            number: pull.number,
            title: pull.title || "",
            body: pull.body ?? null,
            createdAt: pull.created_at,
            closedAt: pull.closed_at ?? null,
            merged: isMerged,
            user: {
              id: pull.user.id,
              login: pull.user.login,
            },
          };

          const repoCtx: RepoContext = {
            owner: repo.owner,
            name: repo.name,
          };

          const prResult = await processPullRequestOpened(db, prCtx, repoCtx, {
            postReply,
            postPrReply,
            finalDeadline: config.FINAL_DEADLINE,
          });

          if (prResult.outcome === "linked") {
            result.recoveredCount++;
            result.reconciledPrs.push({
              repo: `${repo.owner}/${repo.name}`,
              prNumber: pull.number,
              outcome: prResult.outcome,
              title: pull.title,
              author: pull.user.login,
            });
            result.changedRows.push({
              repo: `${repo.owner}/${repo.name}`,
              prNumber: pull.number,
              author: pull.user.login,
              action: "linked",
              before: {},
              after: {
                countsForScore: true,
                githubPrId: String(pull.id),
              },
            });
          }

          existingPr = await db.pullRequest.findFirst({
            where: {
              repoId: repo.id,
              number: pull.number,
            },
            include: {
              issue: true,
              member: true,
            },
          });
        }

        // Backfill real githubPrId if zero or mismatch
        if (existingPr && existingPr.githubPrId !== BigInt(pull.id)) {
          const beforeId = existingPr.githubPrId.toString();
          await db.pullRequest.update({
            where: { id: existingPr.id },
            data: { githubPrId: BigInt(pull.id) },
          });
          result.changedRows.push({
            repo: `${repo.owner}/${repo.name}`,
            prNumber: pull.number,
            author: existingPr.member?.githubLogin || pull.user.login,
            action: "github_id_backfilled",
            before: { githubPrId: beforeId },
            after: { githubPrId: String(pull.id) },
          });
        }

        // Ensure claim status is synced to pr_raised if currently active
        if (existingPr && existingPr.countsForScore && existingPr.issueId) {
          const claim = existingPr.issue?.claims?.find((c: any) => c.memberId === existingPr.memberId);
          if (claim && claim.status === ClaimStatus.active) {
            await db.claim.update({
              where: { id: claim.id },
              data: { status: ClaimStatus.pr_raised },
            });
          }
        }
      }
    } catch (err) {
      console.error(`[prReconciliation] Error reconciling PRs for ${repo.owner}/${repo.name}:`, err);
    }
  }

  // 2. Reconcile merge state (both forward and reverse, enforcing multi-PR conflict precedence)
  const mergeResult = await reconcileMergeState(db, opts, ghPrMap);
  result.updatedMergeCount = mergeResult.updatedCount;
  result.changedRows.push(...mergeResult.changedRows);

  return result;
}

/**
 * Starts a 10-minute periodic reconciliation interval.
 */
export function setupReconciliationInterval(
  db: PrismaClient | any,
  opts: ReconciliationOptions = {},
  intervalMs = 10 * 60 * 1000
): ReturnType<typeof setInterval> {
  return setInterval(() => {
    runPrReconciliation(db, opts).catch((err) => {
      console.error("[reconciliation interval] Error during PR reconciliation:", err);
    });
  }, intervalMs);
}
