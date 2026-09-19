import fs from "node:fs";
import path from "node:path";
import { IssueLevel } from "@prisma/client";
import { prisma } from "../db.js";

export const KNOWN_REPO_GITHUB_IDS: Record<string, bigint> = {
  "aqua-sense": 1376363258n,
  "stackcraft-cli": 1376361762n,
  "campus-flow": 1376362158n,
  "launchpad-node": 1376362463n,
  "pulse-meet": 1376362856n,
  "bom-matrix": 1376360339n,
};

export interface ManifestIssueRecord {
  id: string;
  repo: string;
  number: number;
  level: IssueLevel;
  spots: number;
  title: string;
}

export interface ImportResult {
  reposImported: number;
  issuesImported: number;
  totalIssuesInDb: number;
}

/**
 * Parses the ISSUE_MANIFEST.md markdown table into structured records.
 */
export function parseManifestMarkdown(content: string): ManifestIssueRecord[] {
  const lines = content.split(/\r?\n/);
  const records: ManifestIssueRecord[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith("|") || line.startsWith("|---") || line.includes("github_issue_number")) {
      continue;
    }

    const cols = line
      .split("|")
      .map((c) => c.trim())
      .filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);

    if (cols.length < 6) {
      continue;
    }

    const [id, repo, issueNumRaw, levelRaw, spotsRaw, ...titleParts] = cols;
    if (!id || !repo || !issueNumRaw || !levelRaw || !spotsRaw) {
      continue;
    }

    const number = parseInt(issueNumRaw.replace(/^#/, "").trim(), 10);
    const spots = parseInt(spotsRaw.trim(), 10);
    const levelStr = levelRaw.toLowerCase().trim();
    let level: IssueLevel;
    if (levelStr === "easy") level = IssueLevel.easy;
    else if (levelStr === "medium") level = IssueLevel.medium;
    else if (levelStr === "hard") level = IssueLevel.hard;
    else throw new Error(`Unknown level '${levelRaw}' in manifest for issue ${id}`);

    const title = titleParts.join("|").replace(/\\\|/g, "|").trim();

    records.push({
      id,
      repo,
      number,
      level,
      spots,
      title,
    });
  }

  return records;
}

/**
 * Imports repos and issues from ISSUE_MANIFEST.md into the database.
 * Completely idempotent: running repeatedly leaves the database in the exact same state.
 */
export async function importFromManifest(
  manifestPath?: string,
  deps: { prismaClient?: typeof prisma } = {}
): Promise<ImportResult> {
  const db = deps.prismaClient ?? prisma;

  // Resolve manifest path (default: check parent directory then local)
  let resolvedPath = manifestPath;
  if (!resolvedPath) {
    const candidatePaths = [
      path.resolve(process.cwd(), "ISSUE_MANIFEST.md"),
      path.resolve(process.cwd(), "../ISSUE_MANIFEST.md"),
    ];
    for (const cp of candidatePaths) {
      if (fs.existsSync(cp)) {
        resolvedPath = cp;
        break;
      }
    }
  }

  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    throw new Error(`CRITICAL: ISSUE_MANIFEST.md not found at ${resolvedPath ?? "(checked default locations)"}`);
  }

  const content = fs.readFileSync(resolvedPath, "utf-8");
  const records = parseManifestMarkdown(content);

  if (records.length !== 150) {
    throw new Error(
      `CRITICAL: Expected exactly 150 issues in ${resolvedPath}, but parsed ${records.length}`
    );
  }

  const distinctRepos = Array.from(new Set(records.map((r) => r.repo)));
  if (distinctRepos.length !== 6) {
    throw new Error(
      `CRITICAL: Expected exactly 6 repositories in manifest, but found ${distinctRepos.length}: ${distinctRepos.join(", ")}`
    );
  }

  // 1. Upsert Repos
  const repoMap = new Map<string, string>(); // repo name -> repo db id

  for (const repoName of distinctRepos) {
    const githubRepoId = KNOWN_REPO_GITHUB_IDS[repoName] ?? BigInt(Math.abs(hashString(repoName)));
    const repo = await db.repo.upsert({
      where: {
        owner_name: {
          owner: "AARVAK-VSET",
          name: repoName,
        },
      },
      update: {
        githubRepoId,
      },
      create: {
        owner: "AARVAK-VSET",
        name: repoName,
        githubRepoId,
      },
    });
    repoMap.set(repoName, repo.id);
  }

  // 2. Upsert Issues
  for (const rec of records) {
    const repoId = repoMap.get(rec.repo);
    if (!repoId) {
      throw new Error(`Repo ID not found for repo '${rec.repo}'`);
    }

    const githubRepoId = KNOWN_REPO_GITHUB_IDS[rec.repo] ?? 1000n;
    const githubIssueId = githubRepoId * 100000n + BigInt(rec.number);

    await db.issue.upsert({
      where: {
        repoId_number: {
          repoId,
          number: rec.number,
        },
      },
      update: {
        title: rec.title,
        level: rec.level,
        spots: rec.spots,
        githubIssueId,
      },
      create: {
        repoId,
        number: rec.number,
        title: rec.title,
        level: rec.level,
        spots: rec.spots,
        githubIssueId,
      },
    });
  }

  // 3. Final Assertions
  const totalIssuesCount = await db.issue.count();
  if (totalIssuesCount !== 150) {
    throw new Error(
      `CRITICAL: Manifest import verification failed! Expected 150 issues in database, found ${totalIssuesCount}`
    );
  }

  return {
    reposImported: distinctRepos.length,
    issuesImported: records.length,
    totalIssuesInDb: totalIssuesCount,
  };
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
