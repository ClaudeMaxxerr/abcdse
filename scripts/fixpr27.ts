// scripts/fixpr27.ts
import { prisma } from "../src/db.js";
(async () => {
    const repo = await prisma.repo.findFirst({ where: { name: "campus-flow" } });
    const pr = await prisma.pullRequest.findFirst({ where: { repoId: repo!.id, number: 27 } });

    const updated = await prisma.pullRequest.update({
        where: { id: pr!.id },
        data: {
            githubPrId: BigInt("4583716986"),
            merged: true,
            closedAt: new Date(),
            countsForScore: true,
        },
    });
    console.log("PR updated:", updated.number, "merged =", updated.merged);

    const claim = await prisma.claim.updateMany({
        where: { memberId: pr!.memberId, issueId: pr!.issueId },
        data: { status: "merged" },
    });
    console.log("claims moved to merged:", claim.count);

    // any other PR on the same issue drops to the raised value
    const others = await prisma.pullRequest.findMany({
        where: { issueId: pr!.issueId, id: { not: pr!.id } },
    });
    console.log("other PRs on this issue:", others.length);
    for (const o of others) console.log(`  PR#${o.number} merged=${o.merged}`);

    await prisma.$disconnect();
})();