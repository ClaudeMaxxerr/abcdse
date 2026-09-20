import { prisma } from "../src/db.js";
import { ClaimStatus } from "@prisma/client";

async function main() {
  console.log("Applying organiser decision for aqua-sense issue #21...");

  const issue21 = await prisma.issue.findFirst({
    where: {
      repo: { name: "aqua-sense" },
      number: 21,
    },
  });

  if (!issue21) {
    throw new Error("Issue 21 not found");
  }

  const pr24 = await prisma.pullRequest.findFirst({
    where: { issueId: issue21.id, number: 24 },
  });
  const pr30 = await prisma.pullRequest.findFirst({
    where: { issueId: issue21.id, number: 30 },
  });

  if (!pr24 || !pr30) {
    throw new Error("PR 24 or PR 30 not found");
  }

  console.log("Before State:");
  console.log(`PR #24: merged=${pr24.merged}, locked=${pr24.mergeDecisionLocked}`);
  console.log(`PR #30: merged=${pr30.merged}, locked=${pr30.mergeDecisionLocked}`);

  await prisma.$transaction(async (tx) => {
    // 1. Lock PR #24 as merged = true
    await tx.pullRequest.update({
      where: { id: pr24.id },
      data: {
        merged: true,
        countsForScore: true,
        mergeDecisionLocked: true,
      },
    });

    // 2. Lock PR #30 as merged = false
    await tx.pullRequest.update({
      where: { id: pr30.id },
      data: {
        merged: false,
        countsForScore: true,
        mergeDecisionLocked: true,
      },
    });

    // 3. Set Yogya's claim to merged
    await tx.claim.updateMany({
      where: { issueId: issue21.id, memberId: pr24.memberId },
      data: { status: ClaimStatus.merged },
    });

    // 4. Set Aditya's claim to pr_raised
    await tx.claim.updateMany({
      where: { issueId: issue21.id, memberId: pr30.memberId },
      data: { status: ClaimStatus.pr_raised },
    });

    // 5. Audit logs
    await tx.auditLog.create({
      data: {
        actorMemberId: null,
        actorIp: "127.0.0.1",
        action: "pr_merge_decision",
        targetType: "PullRequest",
        targetId: pr24.id,
        beforeJson: JSON.stringify({ merged: pr24.merged, mergeDecisionLocked: pr24.mergeDecisionLocked }),
        afterJson: JSON.stringify({
          merged: true,
          mergeDecisionLocked: true,
          reason: "Organiser decision: PR #24 scores merged points on quality",
        }),
      },
    });

    await tx.auditLog.create({
      data: {
        actorMemberId: null,
        actorIp: "127.0.0.1",
        action: "pr_merge_decision_demoted",
        targetType: "PullRequest",
        targetId: pr30.id,
        beforeJson: JSON.stringify({ merged: pr30.merged, mergeDecisionLocked: pr30.mergeDecisionLocked }),
        afterJson: JSON.stringify({
          merged: false,
          mergeDecisionLocked: true,
          reason: "Demoted because PR #24 awarded merge on issue #21",
        }),
      },
    });
  });

  const [after24, after30] = await Promise.all([
    prisma.pullRequest.findUnique({ where: { id: pr24.id } }),
    prisma.pullRequest.findUnique({ where: { id: pr30.id } }),
  ]);

  console.log("\nAfter State:");
  console.log(`PR #24: merged=${after24?.merged}, locked=${after24?.mergeDecisionLocked}`);
  console.log(`PR #30: merged=${after30?.merged}, locked=${after30?.mergeDecisionLocked}`);
  console.log("\nOrganiser decision applied and locked successfully!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
