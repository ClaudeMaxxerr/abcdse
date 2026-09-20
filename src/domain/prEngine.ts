/**
 * prEngine.ts — Phase B4
 *
 * Implements PR linking on pull_request opened / reopened / edited,
 * and merge handling on pull_request closed per CONTEXT.md §§ 2.3, 2.5, 2.7, 9.10.
 */

import { PrismaClient, ClaimStatus, IssueLevel } from "@prisma/client";
import { config } from "../config.js";
import { postBotComment, postBotCommentOnPr } from "../github/comments.js";

export interface IssueReference {
  repoOwner?: string;
  repoName?: string;
  issueNumber: number;
}

export interface PullRequestContext {
  id: number;
  number: number;
  title: string;
  body?: string | null;
  createdAt: string;
  closedAt?: string | null;
  merged?: boolean;
  user: {
    id: number;
    login: string;
  };
}

export interface RepoContext {
  owner: string;
  name: string;
}

export type PREngineResult =
  | { outcome: "not_registered"; countsForScore: false; message: string }
  | { outcome: "no_issue_referenced"; countsForScore: false; message: string }
  | { outcome: "ambiguous_claims"; countsForScore: false; message: string }
  | { outcome: "no_valid_claim"; countsForScore: false; message: string; issueId?: string }
  | { outcome: "linked"; countsForScore: true; issueId: string; claimId: string; message: string }
  | { outcome: "already_linked"; countsForScore: boolean; issueId: string; message: string }
  | { outcome: "merged"; countsForScore: boolean; issueId: string; message: string }
  | { outcome: "closed_unmerged"; countsForScore: boolean; issueId: string; message: string };

/**
 * Parses issue references from PR title and body.
 * Matches:
 *  - #<n>, Fixes #<n>, Closes #<n>, Resolves #<n> (case-insensitive)
 *  - Full GitHub issue URLs: https://github.com/<owner>/<repo>/issues/<n>
 */
export function parseIssueReferences(title: string, body?: string | null): IssueReference[] {
  const text = `${title}\n${body ?? ""}`;
  const refs: IssueReference[] = [];
  const seen = new Set<string>();

  // 1. Match full GitHub issue URLs: https://github.com/owner/repo/issues/123
  const urlRegex = /https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/issues\/(\d+)/gi;
  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = urlRegex.exec(text)) !== null) {
    const owner = urlMatch[1]!;
    const repo = urlMatch[2]!;
    const num = parseInt(urlMatch[3]!, 10);
    const key = `${owner.toLowerCase()}/${repo.toLowerCase()}#${num}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ repoOwner: owner, repoName: repo, issueNumber: num });
    }
  }

  // 2. Match `#<n>` with optional preceding keywords Fixes/Closes/Resolves
  // Avoid double matching URLs by matching # preceded by word boundary or start of line or space
  const hashRegex = /(?:(?:fixes|closes|resolves)\s+)?#(\d+)/gi;
  let hashMatch: RegExpExecArray | null;
  while ((hashMatch = hashRegex.exec(text)) !== null) {
    const num = parseInt(hashMatch[1]!, 10);
    const key = `#${num}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ issueNumber: num });
    }
  }

  return refs;
}

export interface PREngineDeps {
  postReply?: (issueId: string, kind: string, body: string, memberId: string | null) => Promise<void>;
  postPrReply?: (owner: string, repo: string, prNumber: number, kind: string, body: string, memberId: string | null) => Promise<void>;
  finalDeadline?: Date;
}

/**
 * Handles pull_request opened, reopened, and edited events.
 */
export async function processPullRequestOpened(
  db: PrismaClient | any,
  prCtx: PullRequestContext,
  repoCtx: RepoContext,
  deps: PREngineDeps = {}
): Promise<PREngineResult> {
  const postReply =
    deps.postReply ??
    (async (issueId: string, kind: string, body: string, memberId: string | null) => {
      await postBotComment(issueId, kind, body, memberId, { prismaClient: db });
    });

  const postPrReply =
    deps.postPrReply ??
    (async (owner: string, repo: string, prNumber: number, kind: string, body: string, memberId: string | null) => {
      await postBotCommentOnPr(owner, repo, prNumber, kind, body, memberId, { prismaClient: db });
    });

  // 1. Resolve Repo
  const repo = await db.repo.findFirst({
    where: {
      owner: repoCtx.owner,
      name: repoCtx.name,
    },
  });

  if (!repo) {
    throw new Error(`Repository ${repoCtx.owner}/${repoCtx.name} not found in database.`);
  }

  // 2. Resolve Member
  const member = await db.member.findUnique({
    where: { githubUserId: BigInt(prCtx.user.id) },
  });

  if (!member) {
    return {
      outcome: "not_registered",
      countsForScore: false,
      message: "Author is not a registered participant.",
    };
  }

  // 3. Parse Issue References
  const parsedRefs = parseIssueReferences(prCtx.title, prCtx.body);
  // Filter for references that either match this repo or do not specify another repo
  const repoRefs = parsedRefs.filter(
    (ref) => !ref.repoName || ref.repoName.toLowerCase() === repoCtx.name.toLowerCase()
  );

  if (repoRefs.length === 0) {
    // Check if member holds active claim(s) on this repo to provide specific guidance
    const memberClaims = await db.claim.findMany({
      where: {
        memberId: member.id,
        status: ClaimStatus.active,
        issue: { repoId: repo.id },
      },
      include: { issue: true },
    });

    let msg: string;
    if (memberClaims.length > 0) {
      const issueNums = memberClaims.map((c: any) => `#${c.issue.number}`).join(", ");
      msg = `No issue reference found in this pull request. To link this PR to your claim and earn points, please edit the PR description or title to include \`Fixes #${memberClaims[0].issue.number}\` (or the issue you claimed: ${issueNums}).`;
    } else {
      msg = `No issue reference found in this pull request. To link this PR and earn points, please edit the PR description or title to include \`Fixes #<issue_number>\` matching your active claim.`;
    }

    await postPrReply(repoCtx.owner, repoCtx.name, prCtx.number, "pr_no_issue_reference", msg, member.id);

    return {
      outcome: "no_issue_referenced",
      countsForScore: false,
      message: msg,
    };
  }

  // 4. Find matching active claims for each referenced issue
  const referencedIssueNumbers = Array.from(new Set(repoRefs.map((r) => r.issueNumber)));
  
  const issues = await db.issue.findMany({
    where: {
      repoId: repo.id,
      number: { in: referencedIssueNumbers },
    },
    include: {
      claims: {
        where: {
          memberId: member.id,
        },
      },
    },
  });

  // Check if this PR was already linked previously
  const existingPr = await db.pullRequest.findFirst({
    where: {
      repoId: repo.id,
      number: prCtx.number,
    },
  });

  // Find issues where the member holds an active claim (or pr_raised if this PR already linked it)
  const matchedActiveIssues = issues.filter((iss: any) =>
    iss.claims.some((c: any) => c.status === ClaimStatus.active || (existingPr && existingPr.issueId === iss.id && c.status === ClaimStatus.pr_raised))
  );

  // If already linked and still valid
  if (existingPr && existingPr.countsForScore && matchedActiveIssues.some((iss: any) => iss.id === existingPr.issueId)) {
    return {
      outcome: "already_linked",
      countsForScore: true,
      issueId: existingPr.issueId,
      message: "PR is already linked to active claim.",
    };
  }

  // Ambiguity check: member has active claims on more than one of the referenced issues
  if (matchedActiveIssues.length > 1) {
    const issueList = matchedActiveIssues.map((i: any) => `#${i.number}`).join(", ");
    const firstIssue = matchedActiveIssues[0]!;

    if (existingPr) {
      await db.pullRequest.update({
        where: { id: existingPr.id },
        data: {
          githubPrId: BigInt(prCtx.id),
          countsForScore: false,
        },
      });
    } else {
      await db.pullRequest.create({
        data: {
          repoId: repo.id,
          number: prCtx.number,
          githubPrId: BigInt(prCtx.id),
          memberId: member.id,
          issueId: firstIssue.id,
          openedAt: new Date(prCtx.createdAt),
          merged: prCtx.merged ?? false,
          countsForScore: false,
        },
      });
    }

    const msg = `Multiple issues (${issueList}) with active claims were referenced. Please state exactly one issue in the PR description so it can be scored.`;
    await postReply(firstIssue.id, "pr_ambiguous_reference", msg, member.id);

    return {
      outcome: "ambiguous_claims",
      countsForScore: false,
      message: msg,
    };
  }

  // Exactly one matched claim
  if (matchedActiveIssues.length === 1) {
    const matchedIssue = matchedActiveIssues[0]!;
    const claim = matchedIssue.claims[0]!;

    await db.$transaction(async (tx: any) => {
      // Update claim status to pr_raised (frees an active slot)
      if (claim.status !== ClaimStatus.merged) {
        await tx.claim.update({
          where: { id: claim.id },
          data: { status: ClaimStatus.pr_raised },
        });
      }

      // Record / Update PullRequest
      if (existingPr) {
        await tx.pullRequest.update({
          where: { id: existingPr.id },
          data: {
            issueId: matchedIssue.id,
            countsForScore: true,
            githubPrId: BigInt(prCtx.id),
            merged: prCtx.merged ?? existingPr.merged ?? false,
          },
        });
      } else {
        await tx.pullRequest.create({
          data: {
            repoId: repo.id,
            number: prCtx.number,
            githubPrId: BigInt(prCtx.id),
            memberId: member.id,
            issueId: matchedIssue.id,
            openedAt: new Date(prCtx.createdAt),
            merged: prCtx.merged ?? false,
            countsForScore: true,
          },
        });
      }
    });

    const msg = `PR linked to issue #${matchedIssue.number}. Your claim status is updated to PR raised (1 active slot freed).`;
    await postReply(matchedIssue.id, "pr_linked", msg, member.id);

    return {
      outcome: "linked",
      countsForScore: true,
      issueId: matchedIssue.id,
      claimId: claim.id,
      message: msg,
    };
  }

  // Zero matched claims (e.g. no claim, claim expired, waitlisted, or wrong issue)
  const referencedIssue = issues[0] ?? null;
  const targetIssueId = referencedIssue ? referencedIssue.id : null;

  if (targetIssueId) {
    if (existingPr) {
      await db.pullRequest.update({
        where: { id: existingPr.id },
        data: {
          githubPrId: BigInt(prCtx.id),
          countsForScore: false,
        },
      });
    } else {
      await db.pullRequest.create({
        data: {
          repoId: repo.id,
          number: prCtx.number,
          githubPrId: BigInt(prCtx.id),
          memberId: member.id,
          issueId: targetIssueId,
          openedAt: new Date(prCtx.createdAt),
          merged: prCtx.merged ?? false,
          countsForScore: false,
        },
      });
    }

    const msg = `This PR will not score — no valid active claim found for issue #${referencedIssue?.number ?? targetIssueId} by @${member.githubLogin}. Per § 2.7: 'PR on an issue not validly claimed.'`;
    await postReply(targetIssueId, "pr_unclaimed", msg, member.id);
    await postPrReply(repoCtx.owner, repoCtx.name, prCtx.number, "pr_unclaimed", msg, member.id);

    return {
      outcome: "no_valid_claim",
      countsForScore: false,
      issueId: targetIssueId,
      message: msg,
    };
  }

  const defaultMsg = `This PR will not score — no valid active claim found by @${member.githubLogin}. Per § 2.7: 'PR on an issue not validly claimed.'`;
  await postPrReply(repoCtx.owner, repoCtx.name, prCtx.number, "pr_unclaimed", defaultMsg, member.id);

  return {
    outcome: "no_valid_claim",
    countsForScore: false,
    message: defaultMsg,
  };
}

/**
 * Handles pull_request closed events (merged or closed without merge).
 */
export async function processPullRequestClosed(
  db: PrismaClient | any,
  prCtx: PullRequestContext,
  repoCtx: RepoContext,
  deps: PREngineDeps = {}
): Promise<PREngineResult> {
  const postReply =
    deps.postReply ??
    (async (issueId: string, kind: string, body: string, memberId: string | null) => {
      await postBotComment(issueId, kind, body, memberId, { prismaClient: db });
    });

  const finalDeadline = deps.finalDeadline ?? config.FINAL_DEADLINE;

  // 1. Resolve Repo
  const repo = await db.repo.findFirst({
    where: {
      owner: repoCtx.owner,
      name: repoCtx.name,
    },
  });

  if (!repo) {
    throw new Error(`Repository ${repoCtx.owner}/${repoCtx.name} not found in database.`);
  }

  // 2. Find PullRequest record by (repoId, number)
  let pr = await db.pullRequest.findFirst({
    where: {
      repoId: repo.id,
      number: prCtx.number,
    },
    include: {
      issue: true,
      member: true,
    },
  });

  // If PR was not previously recorded (e.g. webhook missed opened), try opened first
  if (!pr) {
    await processPullRequestOpened(db, prCtx, repoCtx, deps);
    pr = await db.pullRequest.findFirst({
      where: {
        repoId: repo.id,
        number: prCtx.number,
      },
      include: {
        issue: true,
        member: true,
      },
    });
  }

  if (!pr) {
    return {
      outcome: "no_valid_claim",
      countsForScore: false,
      message: "PR could not be found or linked on close.",
    };
  }

  const isMerged = prCtx.merged === true;
  const closedAt = prCtx.closedAt ? new Date(prCtx.closedAt) : new Date();

  // 3. Check final deadline rule (§ 2.7: "Any PR after the final deadline scores zero")
  let countsForScore = pr.countsForScore;
  if (finalDeadline && closedAt > finalDeadline) {
    countsForScore = false;
  }

  if (isMerged) {
    let actuallyEarnsMerged = countsForScore;

    await db.$transaction(async (tx: any) => {
      // Check if another PR on the SAME issue is already merged
      const otherMergedPrs = await tx.pullRequest.findMany({
        where: {
          issueId: pr.issueId,
          id: { not: pr.id },
          merged: true,
          countsForScore: true,
        },
      });

      if (otherMergedPrs.length > 0) {
        // Sort by closedAt ascending to find the earliest merged PR
        const sorted = [...otherMergedPrs].sort((a, b) => {
          const tA = a.closedAt ? new Date(a.closedAt).getTime() : 0;
          const tB = b.closedAt ? new Date(b.closedAt).getTime() : 0;
          return tA - tB;
        });
        const earliestOther = sorted[0]!;
        const earliestOtherTime = earliestOther.closedAt ? new Date(earliestOther.closedAt).getTime() : 0;
        const thisTime = closedAt.getTime();

        if (earliestOtherTime <= thisTime) {
          // Another PR was merged first, so this PR receives raised value (5)
          actuallyEarnsMerged = false;
        } else {
          // This PR was actually merged earlier! Demote the other PR to merged: false
          await tx.pullRequest.updateMany({
            where: {
              issueId: pr.issueId,
              id: { not: pr.id },
            },
            data: {
              merged: false,
            },
          });
        }
      }

      // Update this PR
      await tx.pullRequest.update({
        where: { id: pr.id },
        data: {
          githubPrId: BigInt(prCtx.id),
          merged: actuallyEarnsMerged,
          closedAt,
          countsForScore,
        },
      });

      if (actuallyEarnsMerged) {
        // Demote all OTHER PRs on the same issue to merged = false (keeps their raised value of 5)
        await tx.pullRequest.updateMany({
          where: {
            issueId: pr.issueId,
            id: { not: pr.id },
          },
          data: {
            merged: false,
          },
        });

        // Update matching claim to merged
        await tx.claim.updateMany({
          where: {
            issueId: pr.issueId,
            memberId: pr.memberId,
          },
          data: {
            status: ClaimStatus.merged,
          },
        });
      } else if (countsForScore) {
        // PR counts for score at raised value (5); ensure claim status is at least pr_raised
        await tx.claim.updateMany({
          where: {
            issueId: pr.issueId,
            memberId: pr.memberId,
            status: ClaimStatus.active,
          },
          data: {
            status: ClaimStatus.pr_raised,
          },
        });
      }
    });

    const msg = actuallyEarnsMerged
      ? `PR #${pr.number} merged! Awarded merged points for issue #${pr.issue.number}.`
      : (countsForScore
          ? `PR #${pr.number} merged. Awarded raised points (5) as another PR was merged first for issue #${pr.issue.number}.`
          : `PR #${pr.number} merged after final deadline. Scores 0 points per § 2.7.`);

    await postReply(pr.issueId, "pr_merged", msg, pr.memberId);

    return {
      outcome: "merged",
      countsForScore,
      issueId: pr.issueId,
      message: msg,
    };
  } else {
    // Closed without merge: retains countsForScore, merged = false (scores raised value of 5)
    await db.pullRequest.update({
      where: { id: pr.id },
      data: {
        githubPrId: BigInt(prCtx.id),
        merged: false,
        closedAt,
        countsForScore,
      },
    });

    const msg = `PR #${pr.number} closed without merge. Retains raised point value.`;
    await postReply(pr.issueId, "pr_closed_unmerged", msg, pr.memberId);

    return {
      outcome: "closed_unmerged",
      countsForScore,
      issueId: pr.issueId,
      message: msg,
    };
  }
}
