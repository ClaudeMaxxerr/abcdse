import { prisma } from "../src/db.js";
(async () => {
    const m = await prisma.member.findMany({ orderBy: { createdAt: "asc" } });
    console.log("members:", m.length);
    for (const x of m) console.log(`${x.githubLogin.padEnd(22)} ${String(x.department).padEnd(24)} ${String(x.team).padEnd(13)} ${x.tier}`);
    await prisma.$disconnect();
})();