import { prisma } from "../src/db.js";
import { runPrReconciliation } from "../src/domain/prReconciliation.js";
import { getMemberScore } from "../src/domain/scoring.js";

async function main() {
  console.log("=== Running Full PR & Merge State Reconciliation ===");
  const result = await runPrReconciliation(prisma);

  console.log("\nReconciliation Summary:");
  console.log(`- Recovered/Linked PRs: ${result.recoveredCount}`);
  console.log(`- Updated Merge State Count: ${result.updatedMergeCount}`);
  console.log(`- Total Open PRs: ${result.totalOpenPrs}`);
  console.log(`- Total Processed PRs across all repos: ${result.totalProcessedPrs}`);

  console.log("\nChanged Rows (Before & After):");
  if (result.changedRows.length === 0) {
    console.log("  No rows required changes (already in sync).");
  } else {
    for (const change of result.changedRows) {
      console.log(`  [${change.action.toUpperCase()}] ${change.repo} PR #${change.prNumber} (Author: ${change.author}):`);
      console.log(`    Before: ${JSON.stringify(change.before)}`);
      console.log(`    After:  ${JSON.stringify(change.after)}`);
    }
  }

  // Inspect adittt18's updated score and PR details
  const aditya = await prisma.member.findFirst({
    where: { githubLogin: "adittt18" },
  });

  if (aditya) {
    const score = await getMemberScore(prisma, aditya.id);
    console.log("\nAditya Sasmal (@adittt18) Score Verification:");
    console.log(`- Display Name: ${score.displayName}`);
    console.log(`- Tier: ${score.tier}`);
    console.log(`- Raw Score: ${score.raw}`);
    console.log(`- Capped Score: ${score.capped} / ${score.tierCap}`);
    console.log(`- Total PRs Raised: ${score.totalPrs}`);
    console.log(`- Total PRs Merged: ${score.mergedPrs}`);
    console.log("- PR Breakdown:");
    for (const pr of score.prBreakdown) {
      console.log(`  * ${pr.repoName} PR #${pr.prNumber} -> Issue #${pr.issueNumber} (${pr.level}): merged=${pr.merged} -> ${pr.points} pts`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
