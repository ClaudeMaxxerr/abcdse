import { prisma } from "../db.js";
import { GitHubApiClient } from "./client.js";
import { GitHubAppTokenManager } from "./auth.js";
import { config } from "../config.js";

export interface PostBotCommentResult {
  posted: boolean;
  commentId?: bigint;
  reason?: string;
}

export interface PostBotCommentDeps {
  prismaClient?: typeof prisma;
  githubClient?: GitHubApiClient;
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
      console.error("[postBotComment] Failed to initialize GitHubApiClient:", err);
      return null;
    }
  }
  return null;
}

/**
 * Posts a bot comment on a GitHub issue, enforcing idempotency via the BotComment table.
 * Refuses to post the same kind twice on the same issue for the same member.
 * Every bot comment is recorded in the database.
 */
export async function postBotComment(
  issueId: string,
  kind: string,
  body: string,
  memberId: string | null = null,
  deps: PostBotCommentDeps = {}
): Promise<PostBotCommentResult> {
  const db = deps.prismaClient ?? prisma;

  // 1. Check if a bot comment of this kind has already been posted
  const existing = await db.botComment.findFirst({
    where: {
      issueId,
      kind,
      memberId: memberId ?? null,
    },
  });

  if (existing) {
    return {
      posted: false,
      commentId: existing.commentId,
      reason: `Bot comment of kind '${kind}' already posted on issue ${issueId}${memberId ? ` for member ${memberId}` : ""}`,
    };
  }

  // 2. Fetch issue and repo metadata needed to post comment via GitHub API
  const issue = await db.issue.findUnique({
    where: { id: issueId },
    include: { repo: true },
  });

  let githubCommentId = BigInt(Date.now()); // fallback ID if client mocked or offline

  const client = deps.githubClient ?? getOrCreateGitHubClient();

  if (client && issue) {
    try {
      const ghRes = await client.createIssueComment(
        issue.repo.owner,
        issue.repo.name,
        issue.number,
        body
      );
      githubCommentId = BigInt(ghRes.id);
    } catch (err) {
      console.error(`[postBotComment] Error posting comment to issue #${issue.number} in ${issue.repo.owner}/${issue.repo.name}:`, err);
    }
  }

  // 3. Record the bot comment in the database
  const recorded = await db.botComment.create({
    data: {
      issueId,
      memberId: memberId ?? null,
      commentId: githubCommentId,
      kind,
    },
  });

  return {
    posted: true,
    commentId: recorded.commentId,
  };
}
