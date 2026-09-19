#!/usr/bin/env tsx
/**
 * seed-rehearsal.ts — Phase B7 Task 5
 *
 * Seeds six test members for end-to-end rehearsal.
 * All members are created directly in the database (no HTTP endpoint used,
 * per the standing rule that no HTTP endpoint may create a member without OAuth).
 *
 * Members seeded:
 *   1. alice-tech    (technical, NEXUS,       tech tier)
 *   2. bob-general   (pr, NEXUS,              general tier)
 *   3. carol-cipher  (social, CIPHER,         general tier)
 *   4. dave-bb       (design, BYTE_BRIGADE,   general tier)
 *   5. eve-ascend    (technical, ASCEND,       tech tier)
 *   6. frank-echo    (event_management, ECHO, general tier)
 *
 * Usage:
 *   DATABASE_URL=... DIRECT_URL=... npx tsx scripts/seed-rehearsal.ts
 *
 * LOG.md NOTE: This script writes directly to the DB without OAuth because
 * the requirement "No HTTP endpoint may create a member without OAuth" applies
 * to HTTP endpoints, not to server-side admin seed scripts. Direct DB writes
 * are used for rehearsal setup only and must be torn down afterwards.
 */

import { PrismaClient, Department, Team, Tier } from "@prisma/client";

const prisma = new PrismaClient();

const REHEARSAL_MEMBERS = [
  {
    githubUserId: BigInt(900000001),
    githubLogin: "member-a-nexus-tech",
    displayName: "Member A (NEXUS Tech)",
    department: Department.technical,
    team: Team.NEXUS,
    tier: Tier.tech,
  },
  {
    githubUserId: BigInt(900000002),
    githubLogin: "member-b-nexus-pr",
    displayName: "Member B (NEXUS PR)",
    department: Department.pr,
    team: Team.NEXUS,
    tier: Tier.general,
  },
  {
    githubUserId: BigInt(900000003),
    githubLogin: "member-c-cipher-tech",
    displayName: "Member C (CIPHER Tech)",
    department: Department.technical,
    team: Team.CIPHER,
    tier: Tier.tech,
  },
  {
    githubUserId: BigInt(900000004),
    githubLogin: "member-d-cipher-social",
    displayName: "Member D (CIPHER Social)",
    department: Department.social,
    team: Team.CIPHER,
    tier: Tier.general,
  },
  {
    githubUserId: BigInt(900000005),
    githubLogin: "member-e-echo-design",
    displayName: "Member E (ECHO Design)",
    department: Department.design,
    team: Team.ECHO,
    tier: Tier.general,
  },
  {
    githubUserId: BigInt(900000006),
    githubLogin: "member-f-echo-rnd",
    displayName: "Member F (ECHO RnD)",
    department: Department.research_and_development,
    team: Team.ECHO,
    tier: Tier.general,
  },
];

async function main() {
  console.log("Seeding 6 rehearsal members...");
  let created = 0;
  let skipped = 0;

  for (const m of REHEARSAL_MEMBERS) {
    const existing = await prisma.member.findUnique({
      where: { githubUserId: m.githubUserId },
    });

    if (existing) {
      console.log(`  SKIP  ${m.githubLogin} (already exists, id=${existing.id})`);
      skipped++;
      continue;
    }

    const member = await prisma.member.create({ data: m });
    console.log(`  CREATE ${m.githubLogin} → id=${member.id}`);
    created++;
  }

  console.log(`\nDone. Created=${created}, Skipped=${skipped}`);
  console.log("Run teardown-rehearsal.ts when finished.");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
