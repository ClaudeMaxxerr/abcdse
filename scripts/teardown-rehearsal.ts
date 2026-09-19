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
  BigInt(900000001),
  BigInt(900000002),
  BigInt(900000003),
  BigInt(900000004),
  BigInt(900000005),
  BigInt(900000006),
];

async function main() {
  console.log("Tearing down rehearsal members and data...");

  // Delete all claims, PRs, waitlist, bot comments on rehearsal repo
  await prisma.botComment.deleteMany({
    where: { issue: { repo: { name: "patch-wars-rehearsal" } } },
  });
  await prisma.pullRequest.deleteMany({
    where: { repo: { name: "patch-wars-rehearsal" } },
  });
  await prisma.claim.deleteMany({
    where: { issue: { repo: { name: "patch-wars-rehearsal" } } },
  });
  await prisma.waitlistEntry.deleteMany({
    where: { issue: { repo: { name: "patch-wars-rehearsal" } } },
  });
  await prisma.issue.deleteMany({
    where: { repo: { name: "patch-wars-rehearsal" } },
  });
  await prisma.repo.deleteMany({
    where: { name: "patch-wars-rehearsal" },
  });

  const result = await prisma.member.deleteMany({
    where: {
      OR: [
        { githubUserId: { in: REHEARSAL_USER_IDS } },
        { githubUserId: { gte: BigInt(900000000) } },
      ],
    },
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
