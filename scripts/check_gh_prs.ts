import { prisma } from "../src/db.js";
import { GitHubApiClient } from "../src/github/client.js";
import { GitHubAppTokenManager } from "../src/github/auth.js";
import { config } from "../src/config.js";

async function main() {
  const privateKey = config.GITHUB_APP_PRIVATE_KEY.includes("\\n")
    ? config.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n")
    : config.GITHUB_APP_PRIVATE_KEY;

  const tokenManager = new GitHubAppTokenManager({
    appId: config.GITHUB_APP_ID,
    privateKey,
    installationId: config.GITHUB_APP_INSTALLATION_ID || "163014815",
  });
  const client = new GitHubApiClient({ tokenManager });

  console.log("Checking aqua-sense PR 24 & 30...");
  const [pr24, pr30] = await Promise.all([
    client.getPullRequest("AARVAK-VSET", "aqua-sense", 24),
    client.getPullRequest("AARVAK-VSET", "aqua-sense", 30),
  ]);

  console.log("GitHub PR 24:", {
    number: pr24.number,
    state: pr24.state,
    merged: pr24.merged,
    merged_at: pr24.merged_at,
    user: pr24.user?.login,
  });

  console.log("GitHub PR 30:", {
    number: pr30.number,
    state: pr30.state,
    merged: pr30.merged,
    merged_at: pr30.merged_at,
    user: pr30.user?.login,
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
