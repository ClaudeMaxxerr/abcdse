#!/usr/bin/env tsx
/**
 * teardown-rehearsal.ts — Phase B7 Task 5
 *
 * Removes all rehearsal data seeded by seed-rehearsal.ts.
 * Deletes the 6 rehearsal members and all their associated data
 * (claims, sessions, PRs, bot comments) via Cascade delete in Prisma schema.
 *
 * Usage:
 *   DATABASE_URL=... DIRECT_URL=... npx tsx scripts/teardown-rehearsal.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const REHEARSAL_USER_IDS = [
  BigInt(9000001),
  BigInt(9000002),
  BigInt(9000003),
  BigInt(9000004),
  BigInt(9000005),
  BigInt(9000006),
];

async function main() {
  console.log("Tearing down 6 rehearsal members...");

  const result = await prisma.member.deleteMany({
    where: { githubUserId: { in: REHEARSAL_USER_IDS } },
  });

  console.log(`Deleted ${result.count} rehearsal member(s) (+ cascaded data).`);

  if (result.count < REHEARSAL_USER_IDS.length) {
    console.warn(
      `Warning: expected to delete ${REHEARSAL_USER_IDS.length} members but only deleted ${result.count}.`
    );
  }

  console.log("Rehearsal teardown complete.");
}

main()
  .catch((err) => {
    console.error("Teardown failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
