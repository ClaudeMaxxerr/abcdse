import { PrismaClient } from "@prisma/client";

async function main() {
  const testUrl = process.env["TEST_DIRECT_URL"] || process.env["TEST_DATABASE_URL"];
  if (!testUrl) {
    console.log("No test url");
    return;
  }
  const db = new PrismaClient({ datasources: { db: { url: testUrl } } });
  await db.$executeRawUnsafe(`ALTER TABLE "patchwars_test"."PullRequest" ADD COLUMN IF NOT EXISTS "mergeDecisionLocked" BOOLEAN NOT NULL DEFAULT false;`);
  console.log("Successfully ensured mergeDecisionLocked exists on patchwars_test.PullRequest");
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
