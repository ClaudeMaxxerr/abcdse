import { prisma } from "../src/db.js";
import { config } from "../src/config.js";

async function main() {
  const issueCount = await prisma.issue.count();
  const rehearsalMembersCount = await prisma.member.count({
    where: { githubUserId: { gte: BigInt(900000001) } },
  });

  console.log("ISSUE_BOARD_COUNT:", issueCount);
  console.log("REHEARSAL_MEMBERS_COUNT:", rehearsalMembersCount);
  console.log("CLAIM_TTL_HOURS:", config.CLAIM_TTL_HOURS);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
