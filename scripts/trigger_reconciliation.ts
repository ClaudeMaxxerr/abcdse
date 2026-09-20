import { prisma } from "../src/db.js";
import { runPrReconciliation } from "../src/domain/prReconciliation.js";

async function main() {
  console.log("Triggering PR reconciliation on database...");
  const result = await runPrReconciliation(prisma);
  console.log("Reconciliation result:", JSON.stringify(result, null, 2));

  // Check PullRequest count and Roboticol's PRs
  const totalPrs = await prisma.pullRequest.count();
  const roboticol = await prisma.member.findFirst({
    where: { githubLogin: "Roboticol" },
    include: {
      prs: {
        include: {
          issue: true,
          repo: true,
        },
      },
      claims: {
        include: {
          issue: true,
        },
      },
    },
  });

  console.log("Total PullRequest records in DB:", totalPrs);
  console.log("Roboticol PRs:", JSON.stringify(roboticol?.prs, null, 2));
  console.log("Roboticol Claims:", JSON.stringify(roboticol?.claims, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
