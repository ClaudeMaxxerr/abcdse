// scripts/fixissue21.ts
import { prisma } from "../src/db.js";

(async () => {
    const repo = await prisma.repo.findFirst({ where: { name: "aqua-sense" } });
    const issue = await prisma.issue.findFirst({ where: { repoId: repo!.id, number: 21 } });

    const winner = await prisma.pullRequest.findFirst({ where: { repoId: repo!.id, number: 24 } });
    const loser = await prisma.pullRequest.findFirst({ where: { repoId: repo!.id, number: 30 } });

    if (!winner || !loser) { console.log("PR row not found — aborting"); return; }

    // jainyogya07 PR#24 -> merged, full 20 pts
    await prisma.pullRequest.update({
        where: { id: winner.id },
        data: { merged: true, countsForScore: true, mergeDecisionLocked: true },
    });
    await prisma.claim.updateMany({
        where: { memberId: winner.memberId, issueId: issue!.id },
        data: { status: "merged" },
    });

    // adittt18 PR#30 -> not merged, keeps 5 pts for participation
    await prisma.pullRequest.update({
        where: { id: loser.id },
        data: { merged: false, countsForScore: true, mergeDecisionLocked: true },
    });
    await prisma.claim.updateMany({
        where: { memberId: loser.memberId, issueId: issue!.id },
        data: { status: "pr_raised" },
    });

    const check = await prisma.pullRequest.findMany({
        where: { issueId: issue!.id },
        include: { member: true },
    });
    console.log("\naqua-sense #21:");
    for (const p of check) {
        console.log(`  PR#${p.number} ${p.member.githubLogin.padEnd(16)} merged=${p.merged} counts=${p.countsForScore} locked=${p.mergeDecisionLocked}`);
    }
    await prisma.$disconnect();
})();