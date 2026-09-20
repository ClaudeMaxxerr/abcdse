import { prisma } from "../src/db.js";
import { writeFileSync, mkdirSync } from "node:fs";

(async () => {
    mkdirSync("backups", { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const data = {
        takenAt: new Date().toISOString(),
        repos: await prisma.repo.findMany(),
        issues: await prisma.issue.findMany(),
        members: await prisma.member.findMany(),
        claims: await prisma.claim.findMany(),
        waitlist: await prisma.waitlistEntry.findMany(),
        pullRequests: await prisma.pullRequest.findMany(),
        botComments: await prisma.botComment.findMany(),
        auditLog: await prisma.auditLog.findMany(),
    };
    const file = `backups/backup-${stamp}.json`;
    writeFileSync(file, JSON.stringify(data, (_k, v) =>
        typeof v === "bigint" ? v.toString() : v, 2));
    console.log("wrote", file);
    for (const [k, v] of Object.entries(data)) {
        if (Array.isArray(v)) console.log(` ${k}: ${v.length}`);
    }
    await prisma.$disconnect();
})();