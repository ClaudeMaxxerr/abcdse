// scripts/linkpr.ts
import { prisma } from "../src/db.js";
(async () => {
    const m = await prisma.member.findFirst({ where: { githubLogin: "Roboticol" } });
    const repo = await prisma.repo.findFirst({ where: { name: "campus-flow" } });
    const issue = await prisma.issue.findFirst({ where: { repoId: repo!.id, number: 19 } });

    const pr = await prisma.pullRequest.create({
        data: {
            memberId: m!.id, issueId: issue!.id, repoId: repo!.id,
            number: 27, githubPrId: BigInt(0),          // set the real PR id if your schema requires it
            openedAt: new Date("2026-09-20T11:19:34Z"),
            merged: false, countsForScore: true,
        },
    });
    await prisma.claim.updateMany({
        where: { memberId: m!.id, issueId: issue!.id, status: "active" },
        data: { status: "pr_raised" },
    });
    console.log("linked PR", pr.number, "-> campus-flow#19");
    await prisma.$disconnect();
})();