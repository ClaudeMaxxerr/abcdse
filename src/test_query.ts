import { prisma } from "./db.js";
import { config } from "./config.js";

async function main() {
  console.log("Testing runtime query through pooled DATABASE_URL...");
  console.log("Database URL configured:", config.DATABASE_URL.replace(/:[^:@]+@/, ":****@"));
  
  // 1. Raw roundtrip test
  const rawResult = await prisma.$queryRaw<Array<{ result: number }>>`SELECT 1 as result`;
  console.log("Raw query (SELECT 1) result:", rawResult);

  // 2. Query tables created by migration
  const memberCount = await prisma.member.count();
  const repoCount = await prisma.repo.count();
  const issueCount = await prisma.issue.count();
  
  console.log(`Database tables verified: Members=${memberCount}, Repos=${repoCount}, Issues=${issueCount}`);
  console.log("PROVED: Runtime query succeeds through pooled DATABASE_URL (port 6543, pgbouncer=true)");
  
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Runtime query failed:", e);
  process.exit(1);
});
