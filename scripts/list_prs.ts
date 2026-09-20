import { prisma } from "../src/db.js";

async function main() {
  const allPrs = await prisma.pullRequest.findMany({
    include: {
      member: true,
      repo: true,
      issue: true,
    },
    orderBy: { openedAt: "desc" },
  });

  console.log(`Total PullRequests in DB: ${allPrs.length}`);
  for (const pr of allPrs) {
    console.log(
      `- PR #${pr.number} on ${pr.repo.name} by ${pr.member.githubLogin} -> Issue #${pr.issue?.number} (${pr.issue?.level}) | countsForScore=${pr.countsForScore} | merged=${pr.merged} | openedAt=${pr.openedAt.toISOString()}`
    );
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
