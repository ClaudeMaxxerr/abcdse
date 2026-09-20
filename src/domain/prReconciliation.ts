/**
 * prReconciliation.ts
 *
 * Periodic background job that lists open and closed pull requests across all registered repos
 * via the GitHub API, reconciling any PR that has a parseable issue reference and a
 * matching claim, populating real githubPrIds, and accurately synchronizing merge states.
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
  const ghPrMap = new Map<
    string,
    {
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
  >();

  for (const repo of repos) {
    try {
      const allPulls = await client.listPullRequests(repo.owner, repo.name, "all");
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
          state: pull.state,
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

  // 2. Multi-PR Merge State Reconciliation by Issue
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

  const finalDeadline = config.FINAL_DEADLINE;

  for (const issue of issuesWithPrs) {
    const prs = issue.pullRequests;
    if (!prs || prs.length === 0) continue;

    // Determine GitHub status for each PR
    const prInfoList = prs.map((pr: any) => {
      const ghInfo = ghPrMap.get(`${pr.repoId}:${pr.number}`);
      const isMergedOnGitHub = ghInfo ? ghInfo.isMerged : pr.merged;
      const closedAt = ghInfo?.closedAt ?? (pr.closedAt ? new Date(pr.closedAt) : null);
      return {
        pr,
        isMergedOnGitHub,
        closedAt,
      };
    });

    const mergedPrsOnGh = prInfoList.filter((p: any) => p.isMergedOnGitHub);

    if (mergedPrsOnGh.length > 0) {
      // Find the PR with the EARLIEST merge timestamp
      const sortedMerged = [...mergedPrsOnGh].sort((a: any, b: any) => {
        const tA = a.closedAt ? new Date(a.closedAt).getTime() : 0;
        const tB = b.closedAt ? new Date(b.closedAt).getTime() : 0;
        return tA - tB;
      });

      const firstMerged = sortedMerged[0]!;

      for (const item of prInfoList) {
        const pr = item.pr;
        const shouldBeMerged = pr.id === firstMerged.pr.id;
        const closedAtDate = item.closedAt ?? pr.closedAt ?? new Date();
        
        let countsForScore = pr.countsForScore;
        if (finalDeadline && closedAtDate > finalDeadline) {
          countsForScore = false;
        }

        const wasMerged = pr.merged;
        const hadCounts = pr.countsForScore;

        if (wasMerged !== shouldBeMerged || hadCounts !== countsForScore || pr.closedAt?.toISOString() !== closedAtDate.toISOString()) {
          await db.pullRequest.update({
            where: { id: pr.id },
            data: {
              merged: shouldBeMerged,
              closedAt: closedAtDate,
              countsForScore,
            },
          });

          result.updatedMergeCount++;
          result.changedRows.push({
            repo: `${pr.repo.owner}/${pr.repo.name}`,
            prNumber: pr.number,
            issueNumber: issue.number,
            author: pr.member.githubLogin,
            action: "merge_status_corrected",
            before: {
              merged: wasMerged,
              countsForScore: hadCounts,
            },
            after: {
              merged: shouldBeMerged,
              countsForScore,
            },
          });
        }

        // Update corresponding claim status
        if (shouldBeMerged && countsForScore) {
          await db.claim.updateMany({
            where: {
              issueId: issue.id,
              memberId: pr.memberId,
            },
            data: {
              status: ClaimStatus.merged,
            },
          });
        } else if (countsForScore) {
          const memberClaim = issue.claims.find((c: any) => c.memberId === pr.memberId);
          if (memberClaim && memberClaim.status === ClaimStatus.active) {
            await db.claim.update({
              where: { id: memberClaim.id },
              data: {
                status: ClaimStatus.pr_raised,
              },
            });
          }
        }
      }
    } else {
      // None merged on GitHub
      for (const item of prInfoList) {
        const pr = item.pr;
        if (pr.merged) {
          await db.pullRequest.update({
            where: { id: pr.id },
            data: { merged: false },
          });
          result.updatedMergeCount++;
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
  }

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
