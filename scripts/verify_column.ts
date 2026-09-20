import { prisma } from "../src/db.js";

async function main() {
  const res = await prisma.$queryRawUnsafe(
    "SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'PullRequest' AND column_name = 'mergeDecisionLocked';"
  );
  console.log("Column verification result:", res);
}

main().catch(console.error).finally(() => prisma.$disconnect());
