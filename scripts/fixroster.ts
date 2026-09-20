// scripts/fixroster.ts
// Corrects department/team/tier for everyone registered so far.
// Safe to re-run. Run:  npx tsx scripts/fixroster.ts
import { prisma } from "../src/db.js";

// Department enum values: technical | pr | research_and_development
//                         event_management | social_and_design
// Team enum values:       NEXUS | CIPHER | BYTE_BRIGADE | ASCEND | ECHO

const ROSTER: Record<string, { name: string; dept: string; team: string }> = {
    // ---- CIPHER ----
    "apurv99-cloud": { name: "Apurva", dept: "technical", team: "CIPHER" },
    "Tavishi-Jain": { name: "Tavishi Jain", dept: "research_and_development", team: "CIPHER" },
    "Ryder713": { name: "Ridhi Jaiswal", dept: "social_and_design", team: "CIPHER" },
    "anushkaarora-coder": { name: "Anushka Arora", dept: "pr", team: "CIPHER" },

    // ---- ECHO ----
    "akshssss": { name: "Akshansh Bansal", dept: "event_management", team: "ECHO" },

    // ---- ASCEND ----
    "jainyogya07": { name: "Yogay Jain", dept: "technical", team: "ASCEND" },
    "PashinP": { name: "Pashin Pruhi", dept: "technical", team: "ASCEND" },
    "ParthMudgal07": { name: "Parth", dept: "research_and_development", team: "ASCEND" },
    "rishikaajainn": { name: "Rishika Jain", dept: "pr", team: "ASCEND" },
    "parvgoyal29": { name: "Parv Goyal", dept: "social_and_design", team: "ASCEND" },

    // ---- NEXUS ----
    "KA-1205": { name: "Kartik Arora", dept: "technical", team: "NEXUS" },
    //"Mayank-kumar001": { name: "Mayank Kumar", dept: "technical", team: "NEXUS" },
    "Mayank-Kumar0018": { name: "Mayank Kumar", dept: "technical", team: "NEXUS" },

    // ---- BYTE BRIGADE ----
    "mr-yuvie": { name: "Yuv Jindal", dept: "technical", team: "BYTE_BRIGADE" },
    "Roboticol": { name: "Oishik Guha", dept: "research_and_development", team: "BYTE_BRIGADE" },
    "devansh-dua": { name: "Devansh Dua", dept: "pr", team: "BYTE_BRIGADE" },
    "Lynx330": { name: "Aditya Balodi", dept: "event_management", team: "BYTE_BRIGADE" },
    "adittt18": { name: "Aditya Sasmal", dept: "social_and_design", team: "BYTE_BRIGADE" },
    "Simran129546": { name: "Simran", dept: "social_and_design", team: "BYTE_BRIGADE" },
};

// Duplicate / test accounts to remove. Comment out any you want to keep.
const DELETE: string[] = [
    // Add any test or duplicate accounts here, e.g. "ClaudeMaxxerr", "Dakxsh23"
];

(async () => {
    console.log("=== corrections ===");
    for (const [login, v] of Object.entries(ROSTER)) {
        const m = await prisma.member.findFirst({ where: { githubLogin: login } });
        if (!m) {
            console.log(`  SKIP  ${login.padEnd(22)} not registered yet`);
            continue;
        }
        const tier = v.dept === "technical" ? "tech" : "general";
        await prisma.member.update({
            where: { id: m.id },
            data: {
                department: v.dept as never,
                team: v.team as never,
                tier: tier as never,
                displayName: v.name,
            },
        });
        console.log(`  OK    ${login.padEnd(22)} ${v.name.padEnd(17)} ${v.dept.padEnd(25)} ${v.team.padEnd(13)} ${tier}`);
    }

    console.log("\n=== removals ===");
    for (const login of DELETE) {
        const m = await prisma.member.findFirst({ where: { githubLogin: login } });
        if (!m) { console.log(`  SKIP  ${login} not found`); continue; }
        const claims = await prisma.claim.count({ where: { memberId: m.id } });
        const prs = await prisma.pullRequest.count({ where: { memberId: m.id } });
        if (claims || prs) {
            console.log(`  KEPT  ${login} has ${claims} claims / ${prs} PRs — remove by hand if intended`);
            continue;
        }
        await prisma.session.deleteMany({ where: { memberId: m.id } });
        await prisma.member.delete({ where: { id: m.id } });
        console.log(`  DEL   ${login}`);
    }

    console.log("\n=== final roster ===");
    const all = await prisma.member.findMany({ orderBy: [{ team: "asc" }, { department: "asc" }] });
    for (const m of all) {
        console.log(`  ${String(m.team).padEnd(13)} ${String(m.department).padEnd(25)} ${String(m.tier).padEnd(8)} ${m.githubLogin}`);
    }
    console.log(`\n  total: ${all.length}`);
    const tech = all.filter(m => String(m.tier) === "tech");
    console.log(`  technical: ${tech.length} (target 15, 3 per team)`);
    for (const t of ["NEXUS", "CIPHER", "BYTE_BRIGADE", "ASCEND", "ECHO"]) {
        const inTeam = all.filter(m => String(m.team) === t);
        const techIn = inTeam.filter(m => String(m.tier) === "tech");
        console.log(`    ${t.padEnd(13)} ${inTeam.length} members, ${techIn.length} technical`);
    }
    await prisma.$disconnect();
})();