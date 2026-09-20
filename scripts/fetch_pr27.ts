import { config } from "../src/config.js";
import { prisma } from "../src/db.js";

async function main() {
  const token = config.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    "User-Agent": "PatchWars-Tracker-2026",
    Accept: "application/vnd.github.v3+json",
  };
  if (token) {
    headers["Authorization"] = `token ${token}`;
  }

  console.log("Fetching https://api.github.com/repos/AARVAK-VSET/campus-flow/pulls/27 ...");
  const res = await fetch("https://api.github.com/repos/AARVAK-VSET/campus-flow/pulls/27", { headers });
  console.log("Status:", res.status);
  if (res.ok) {
    const data = await res.json();
    console.log("PR #27 details:");
    console.log("- Title:", data.title);
    console.log("- Body:", JSON.stringify(data.body));
    console.log("- User:", data.user?.login);
    console.log("- Created At:", data.created_at);
    console.log("- Updated At:", data.updated_at);
    console.log("- Merged At:", data.merged_at);
  } else {
    console.log("Error body:", await res.text());
  }

  console.log("\nFetching https://api.github.com/repos/AARVAK-VSET/bom-matrix/pulls/28 for comparison ...");
  const res2 = await fetch("https://api.github.com/repos/AARVAK-VSET/bom-matrix/pulls/28", { headers });
  console.log("Status:", res2.status);
  if (res2.ok) {
    const data2 = await res2.json();
    console.log("PR #28 details:");
    console.log("- Title:", data2.title);
    console.log("- Body:", JSON.stringify(data2.body));
    console.log("- User:", data2.user?.login);
    console.log("- Created At:", data2.created_at);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
