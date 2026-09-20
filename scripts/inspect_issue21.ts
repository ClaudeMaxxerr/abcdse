import { prisma } from "../src/db.js";

async function main() {
  const issue21 = await prisma.issue.findFirst({
    where: {
      repo: { name: "aqua-sense" },
      number: 21,
    },
    include: {
      claims: { include: { member: true } },
      pullRequests: { include: { member: true } },
      botComments: true,
    },
  });

  console.log("Issue 21 on aqua-sense:", JSON.stringify(issue21, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));

  // Check all PRs on issue 21
  const prs = await prisma.pullRequest.findMany({
    where: { issueId: issue21?.id },
    include: { member: true, repo: true },
  });
  console.log("PRs on Issue 21:", JSON.stringify(prs, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
