import { describe, it, expect } from "vitest";
import path from "node:path";
import { parseManifestMarkdown, importFromManifest } from "../src/importer/manifest.js";

describe("ISSUE_MANIFEST.md Importer", () => {
  const manifestPath = path.resolve(process.cwd(), "../ISSUE_MANIFEST.md");

  it("fails with a clear message if ISSUE_MANIFEST.md is absent", async () => {
    const nonexistentPath = path.resolve(process.cwd(), "nonexistent_manifest.md");
    await expect(importFromManifest(nonexistentPath)).rejects.toThrow(
      /ISSUE_MANIFEST\.md not found/
    );
  });

  it("correctly parses 150 issues across 6 repos from ISSUE_MANIFEST.md", async () => {
    const fs = await import("node:fs");
    const content = fs.readFileSync(manifestPath, "utf-8");
    const records = parseManifestMarkdown(content);

    expect(records).toHaveLength(150);

    const repos = new Set(records.map((r) => r.repo));
    expect(repos.size).toBe(6);
    expect(repos).toContain("aqua-sense");
    expect(repos).toContain("stackcraft-cli");
    expect(repos).toContain("campus-flow");
    expect(repos).toContain("launchpad-node");
    expect(repos).toContain("pulse-meet");
    expect(repos).toContain("bom-matrix");
  });

  it("is idempotent: running import twice leaves the database in the exact same state", async () => {
    // In-memory mock database storing repos and issues
    const reposDb = new Map<string, any>();
    const issuesDb = new Map<string, any>();

    const mockDb = {
      repo: {
        upsert: async ({ where, update, create }: any) => {
          const key = `${where.owner_name.owner}/${where.owner_name.name}`;
          if (reposDb.has(key)) {
            const existing = reposDb.get(key);
            const updated = { ...existing, ...update };
            reposDb.set(key, updated);
            return updated;
          }
          const rec = { id: `repo-${reposDb.size + 1}`, ...create };
          reposDb.set(key, rec);
          return rec;
        },
      },
      issue: {
        upsert: async ({ where, update, create }: any) => {
          const key = `${where.repoId_number.repoId}:${where.repoId_number.number}`;
          if (issuesDb.has(key)) {
            const existing = issuesDb.get(key);
            const updated = { ...existing, ...update };
            issuesDb.set(key, updated);
            return updated;
          }
          const rec = { id: `issue-${issuesDb.size + 1}`, ...create };
          issuesDb.set(key, rec);
          return rec;
        },
        count: async () => issuesDb.size,
      },
    } as any;

    // Run 1
    const run1 = await importFromManifest(manifestPath, { prismaClient: mockDb });
    expect(run1.reposImported).toBe(6);
    expect(run1.issuesImported).toBe(150);
    expect(run1.totalIssuesInDb).toBe(150);
    expect(reposDb.size).toBe(6);
    expect(issuesDb.size).toBe(150);

    // Run 2 (idempotency check)
    const run2 = await importFromManifest(manifestPath, { prismaClient: mockDb });
    expect(run2.reposImported).toBe(6);
    expect(run2.issuesImported).toBe(150);
    expect(run2.totalIssuesInDb).toBe(150);
    expect(reposDb.size).toBe(6);
    expect(issuesDb.size).toBe(150);
  });
});
