// scripts/whycant.ts
import { prisma } from "../src/db.js";
(async () => {
    const m = await prisma.member.findFirst({ where: { githubLogin: "ClaudeMaxxerr" } });
    console.log("member:", m?.id, m?.githubLogin, m?.department, m?.team);
    console.log("claims:   ", await prisma.claim.count({ where: { memberId: m!.id } }));
    console.log("prs:      ", await prisma.pullRequest.count({ where: { memberId: m!.id } }));
    console.log("waitlist: ", await prisma.waitlistEntry.count({ where: { memberId: m!.id } }));
    console.log("full row:", JSON.stringify(m, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2));
    await prisma.$disconnect();
})();