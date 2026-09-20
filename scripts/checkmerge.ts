// scripts/checkmerge.ts
import { prisma } from "../src/db.js";
(async () => {
    const repo = await prisma.repo.findFirst({ where: { name: "campus-flow" } });
    const pr = await prisma.pullRequest.findFirst({
        where: { repoId: repo!.id, number: 27 }, include: { issue: true, member: true },
    });
    console.log("PR row:", JSON.stringify(pr, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2));

    const d = await prisma.webhookDelivery.findMany({
        where: { event: "pull_request", action: "closed" }, orderBy: { receivedAt: "desc" }, take: 5,
    });
    console.log("\nrecent pull_request.closed deliveries:", d.length);
    for (const x of d) console.log(`  ${x.receivedAt.toISOString()} ${x.status} ${x.error ?? ""}`);
    await prisma.$disconnect();
})();