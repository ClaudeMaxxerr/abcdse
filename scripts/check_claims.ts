import { prisma } from "../src/db.js";

async function main() {
  const members = await prisma.member.findMany({
    where: { githubUserId: { gte: BigInt(900000000) } },
    include: {
      claims: {
        include: { issue: true },
      },
      pullRequests: {
        include: { issue: true },
      },
      waitlistEntries: {
        include: { issue: true },
      },
    },
  });

  console.log("=== SEEDED MEMBERS AUDIT ===");
  for (const m of members) {
    console.log(`\nMember ${m.githubLogin} (${m.team} / ${m.tier}):`);
    console.log("  Claims:", m.claims.map(c => `#${c.issue.number} status=${c.status}`));
    console.log("  PRs:", m.pullRequests.map(p => `PR #${p.number} on Issue #${p.issue.number} merged=${p.merged} countsForScore=${p.countsForScore}`));
    console.log("  Waitlist:", m.waitlistEntries.map(w => `#${w.issue.number} pos=${w.position}`));
  }

  const botComments = await prisma.botComment.findMany({
    include: { issue: true },
  });
  console.log(`\nTotal BotComments in DB: ${botComments.length}`);
  for (const b of botComments.slice(0, 10)) {
    console.log(`  Issue #${b.issue.number} kind=${b.kind} commentId=${b.commentId}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
