import { importFromManifest } from "./manifest.js";
import { prisma } from "../db.js";

async function main() {
  console.log("Starting import of ISSUE_MANIFEST.md into Supabase database...");
  const result = await importFromManifest();
  console.log("Import successfully completed!");
  console.log(`Repositories imported: ${result.reposImported}`);
  console.log(`Issues imported: ${result.issuesImported}`);
  console.log(`Total issues in database: ${result.totalIssuesInDb}`);

  // Print sample from database to verify
  const sample = await prisma.issue.findFirst({
    include: { repo: true },
  });
  console.log("Database verification sample:", {
    repo: sample?.repo.name,
    number: sample?.number,
    title: sample?.title,
    level: sample?.level,
    spots: sample?.spots,
  });

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Importer failed:", err);
  process.exit(1);
});
