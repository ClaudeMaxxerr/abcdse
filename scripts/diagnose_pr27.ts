import { prisma } from "../src/db.js";

async function main() {
  console.log("=== DIAGNOSING PR #27 for Roboticol ===");
  
  // 1. Check all webhook deliveries
  const deliveries = await prisma.webhookDelivery.findMany({
    where: {
      event: "pull_request",
    },
    orderBy: { receivedAt: "asc" },
  });

  console.log(`Total pull_request webhook deliveries: ${deliveries.length}`);
  for (const d of deliveries) {
    const payload = JSON.parse(d.payloadJson || "{}");
    const pr = payload.pull_request;
    const repo = payload.repository;
    const sender = payload.sender;
    console.log(`- ID: ${d.id}, deliveryId: ${d.deliveryId}, action: ${d.action}, status: ${d.status}, error: ${d.error}`);
    console.log(`  Repo: ${repo?.full_name}, PR#: ${pr?.number}, sender: ${sender?.login}, PR title: ${pr?.title}`);
    console.log(`  PR body: ${JSON.stringify(pr?.body)}`);
  }

  // 2. Check Member Roboticol
  const roboticol = await prisma.member.findFirst({
    where: { githubLogin: { equals: "Roboticol", mode: "insensitive" } },
    include: { claims: { include: { issue: { include: { repo: true } } } }, pullRequests: true },
  });
  console.log("\nMember Roboticol:", roboticol?.id, roboticol?.githubLogin, "githubUserId:", roboticol?.githubUserId);
  console.log("Claims held by Roboticol:");
  for (const c of roboticol?.claims || []) {
    console.log(`  Claim ID: ${c.id}, status: ${c.status}, repo: ${c.issue.repo.name}, issue #${c.issue.number}, level: ${c.issue.level}`);
  }

  // 3. Check Campus Flow issues & PRs
  const campusFlowRepo = await prisma.repo.findFirst({
    where: { name: "campus-flow" },
    include: { issues: true, pullRequests: true },
  });
  console.log("\nCampus-flow repo ID:", campusFlowRepo?.id);
  console.log("Campus-flow PRs in DB:");
  for (const pr of campusFlowRepo?.pullRequests || []) {
    console.log(`  PR #${pr.number}, memberId: ${pr.memberId}, issueId: ${pr.issueId}, countsForScore: ${pr.countsForScore}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
