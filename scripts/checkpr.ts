// scripts/checkpr.ts
import { prisma } from "../src/db.js";
(async () => {
    const d = await prisma.webhookDelivery.findMany({
        where: { event: "pull_request" },
        orderBy: { receivedAt: "asc" },
    });
    console.log("pull_request deliveries recorded:", d.length);
    for (const x of d) console.log(`  ${x.receivedAt.toISOString()} ${x.action} ${x.status} ${x.error ?? ""}`);

    const prs = await prisma.pullRequest.findMany({ include: { issue: true, member: true } });
    console.log("\nPRs linked:", prs.length);
    for (const p of prs) console.log(`  ${p.member.githubLogin.padEnd(20)} PR#${p.number} -> issue #${p.issue?.number} counts=${p.countsForScore}`);
    await prisma.$disconnect();
})();
