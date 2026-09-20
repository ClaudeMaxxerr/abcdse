// scripts/diag.ts
import { prisma } from "../src/db.js";
(async () => {
    const prs = await prisma.pullRequest.findMany({
        include: { repo: true, issue: true, member: true },
        orderBy: { openedAt: "asc" },
    });
    console.log("all PRs:");
    for (const p of prs) {
        console.log(`  ${p.repo.name.padEnd(16)} PR#${String(p.number).padEnd(4)} issue#${String(p.issue?.number).padEnd(4)} ` +
            `githubPrId=${p.githubPrId.toString().padEnd(12)} merged=${String(p.merged).padEnd(5)} counts=${p.countsForScore} ${p.member.githubLogin}`);
    }
    const zero = prs.filter(p => p.githubPrId === BigInt(0));
    console.log(`\nrows with githubPrId=0: ${zero.length}`);

    const d = await prisma.webhookDelivery.findMany({
        where: { event: "pull_request", action: "closed" },
        orderBy: { receivedAt: "desc" }, take: 10,
    });
    console.log("\nrecent pull_request.closed:");
    for (const x of d) console.log(`  ${x.receivedAt.toISOString()} ${x.status} ${x.error ?? ""}`);
    await prisma.$disconnect();
})();