/**
 * prReconciliation.ts
 *
 * Periodic background job that lists open pull requests across all registered repos
 * via the GitHub API, reconciling any PR that has a parseable issue reference and a
 * matching claim but is unlinked or has no PullRequest record.
 *
 * Ensures lost webhook deliveries self-heal automatically and idempotently.
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

export interface ReconciliationResult {
  recoveredCount: number;
  totalOpenPrs: number;
  reconciledPrs: Array<{
    repo: string;
    prNumber: number;
    outcome: string;
    title: string;
    author: string;
  }>;
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
    totalOpenPrs: 0,
    reconciledPrs: [],
  };

  if (!client) {
    return result;
  }

  // 1. Fetch all repos registered in DB
  const repos = await db.repo.findMany();

  for (const repo of repos) {
    try {
      const openPulls = await client.listOpenPullRequests(repo.owner, repo.name);
      result.totalOpenPrs += openPulls.length;

      for (const pull of openPulls) {
        // Check if PR already exists in DB
        const existingPr = await db.pullRequest.findFirst({
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
          },
        });

        // If PR already linked with countsForScore=true, check if claim status is synced
        if (existingPr && existingPr.countsForScore && existingPr.issueId) {
          const claim = existingPr.issue?.claims?.find((c: any) => c.memberId === existingPr.memberId);
          if (claim && claim.status === ClaimStatus.active) {
            await db.claim.update({
              where: { id: claim.id },
              data: { status: ClaimStatus.pr_raised },
            });
          }
          continue;
        }

        // PR missing or unlinked — process through PR engine
        const prCtx: PullRequestContext = {
          id: pull.id,
          number: pull.number,
          title: pull.title || "",
          body: pull.body ?? null,
          createdAt: pull.created_at,
          closedAt: pull.closed_at ?? null,
          merged: pull.merged_at != null,
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
        }
      }
    } catch (err) {
      console.error(`[prReconciliation] Error reconciling PRs for ${repo.owner}/${repo.name}:`, err);
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
