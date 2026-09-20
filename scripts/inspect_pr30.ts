import { prisma } from "../src/db.js";

async function main() {
  const pr30s = await prisma.pullRequest.findMany({
    where: { number: 30 },
    include: { repo: true, issue: true, member: true },
  });

  console.log("PR 30 rows in DB:", JSON.stringify(pr30s, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));

  // Search webhook deliveries for pull_request events mentioning PR 30 or aqua-sense
  const deliveries = await prisma.webhookDelivery.findMany({
    where: { event: "pull_request" },
    orderBy: { receivedAt: "desc" },
    take: 30,
  });

  console.log(`Found ${deliveries.length} recent pull_request webhook deliveries.`);
  for (const d of deliveries) {
    console.log(`Delivery ${d.deliveryUuid} | Action: ${d.action} | Status: ${d.status} | Error: ${d.error} | At: ${d.receivedAt.toISOString()}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
