import { prisma } from "../src/db.js";
import { execSync } from "node:child_process";

const OWNER = "AARVAK-VSET";
const NAME = "patch-wars-rehearsal";

const gh = (args: string) =>
    JSON.parse(execSync(`gh api ${args}`, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }));

(async () => {
    const repoData = gh(`repos/${OWNER}/${NAME}`);

    const repo = await prisma.repo.upsert({
        where: { githubRepoId: BigInt(repoData.id) },
        update: {},
        create: { owner: OWNER, name: NAME, githubRepoId: BigInt(repoData.id) },
    });
    console.log("repo", repo.id, repo.name);

    const issues = gh(
        `repos/${OWNER}/${NAME}/issues --method GET -F state=all -F per_page=100 --paginate`
    );

    for (const i of issues) {
        if (i.pull_request) continue;
        const labels: string[] = i.labels.map((l: any) => l.name);
        const level = labels.find((l) => ["easy", "medium", "hard"].includes(l));
        if (!level) {
            console.log(`SKIP #${i.number} — no level label`);
            continue;
        }
        const spots = level === "easy" ? 1 : 2;
        await prisma.issue.upsert({
            where: { repoId_number: { repoId: repo.id, number: i.number } },
            update: { title: i.title, level: level as any, spots },
            create: {
                repoId: repo.id,
                number: i.number,
                title: i.title,
                level: level as any,
                spots,
                githubIssueId: BigInt(i.id),
            },
        });
        console.log(`#${i.number} [${level}] spots=${spots} ${i.title}`);
    }

    console.log("\ntotal issues in db:", await prisma.issue.count());
    await prisma.$disconnect();
})();