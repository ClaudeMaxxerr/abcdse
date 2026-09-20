import { prisma } from "../src/db.js";

async function main() {
  const member = await prisma.member.findFirst({
    where: { githubLogin: "ParthMudgal07" },
    include: {
      claims: true,
      pullRequests: {
        include: {
          issue: { include: { repo: true } },
          repo: true,
        },
      },
      botComments: {
        include: {
          issue: { include: { repo: true } },
        },
      },
    },
  });

  console.log("Member:", JSON.stringify(member, (k, v) => typeof v === "bigint" ? v.toString() : v, 2));

  // Check all PRs for ParthMudgal07
  const prs = await prisma.pullRequest.findMany({
    where: { member: { githubLogin: "ParthMudgal07" } },
    include: { issue: { include: { repo: true } }, repo: true },
  });
  console.log("PRs:", JSON.stringify(prs, (k, v) => typeof v === "bigint" ? v.toString() : v, 2));

  await prisma.$disconnect();
}

main();
