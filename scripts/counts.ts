import { prisma } from "../src/db.js";

(async () => {
    console.log("issues ", await prisma.issue.count());
    console.log("members", await prisma.member.count());
    console.log("claims ", await prisma.claim.count());
    console.log("prs    ", await prisma.pullRequest.count());
    console.log("waitlist", await prisma.waitlistEntry.count());
    console.log("repos  ", await prisma.repo.count());

    console.log("--- issues per repo ---");

    for (const r of await prisma.repo.findMany()) {
        console.log(
            " ",
            r.name,
            await prisma.issue.count({ where: { repoId: r.id } })
        );
    }

    await prisma.$disconnect();
})();