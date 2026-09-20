import { prisma } from "../src/db.js";

async function main() {
  const issues = await prisma.issue.findMany({
    include: {
      repo: true,
      pullRequests: {
        include: { member: true },
      },
    },
  });

  for (const issue of issues) {
    if (issue.pullRequests.length > 1) {
      console.log(`\nIssue #${issue.number} on ${issue.repo.name} (spots=${issue.spots}, level=${issue.level}):`);
      for (const pr of issue.pullRequests) {
        console.log(`  - PR #${pr.number} by ${pr.member.githubLogin}: merged=${pr.merged}, counts=${pr.countsForScore}, closedAt=${pr.closedAt?.toISOString()}`);
      }
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
