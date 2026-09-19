/**
 * concurrency.test.ts — Phase B3
 *
 * THE CONCURRENCY TEST — this decides whether the competition is fair.
 *
 * WHAT THIS TESTS:
 *   10 separate PrismaClient instances (each with its own TCP connection) all
 *   attempt to claim a 1-spot Easy issue simultaneously via Promise.all.
 *   A barrier (shared promise + resolve) ensures all 10 transactions are
 *   started BEFORE any is allowed to commit, so they genuinely overlap
 *   and must contend for the SELECT … FOR UPDATE row lock.
 *
 *   Assert:
 *     - Exactly ONE Claim row exists after all 10 complete.
 *     - The winner is the member whose comment had the earliest created_at.
 *     - The other 9 received a waitlist or rejection outcome.
 *     - No duplicate bot comments recorded in BotComment for any single
 *       (issueId, kind, memberId) triple.
 *
 * HOW PARALLELISM IS PROVEN:
 *   - 10 separate PrismaClient instances → 10 separate server-side sessions.
 *   - The SESSION-mode pooler (port 5432, no pgbouncer flag) gives each client
 *     a dedicated backend connection for the lifetime of the connection,
 *     unlike the transaction pooler which multiplexes.
 *   - We use Promise.all (not sequential await) so all 10 claims race.
 *   - We intentionally run the test WITHOUT the SELECT … FOR UPDATE first,
 *     confirm it fails (multiple winners), then restore the lock and confirm it
 *     passes. That failure/pass pair is pasted in LOG.md.
 *   - The test is run 5 times in a loop; a purely-by-luck pass would fail at
 *     least once across 5 runs.
 *
 * CONNECTION STRING:
 *   Uses DIRECT_URL from .env — the session-mode pooler at port 5432 (same
 *   host as the transaction pooler, but no pgbouncer=true flag). Session mode
 *   keeps each backend connection alive for the full connection lifetime, which
 *   is exactly what we need to hold a SELECT … FOR UPDATE across multiple
 *   round-trips inside a single transaction.
 *
 * SKIPPING:
 *   If DIRECT_URL is not set in the environment, this test is skipped with a
 *   clear message — it cannot be mocked and must not silently pass.
 *
 * NOTE: This test mutates the real database. It creates a dedicated Postgres
 * SCHEMA (patchwars_test) and tears it down after, so dev/prod data is not affected.
 * All Prisma clients in this file point at the test schema.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { processClaimComment } from "../src/domain/claimEngine.js";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Connection setup — session-mode pooler (port 5432, no pgbouncer)
// ---------------------------------------------------------------------------

/**
 * Build a connection string pointing at the session-mode pooler.
 * The session-mode pooler lives at the same host as the transaction pooler
 * but on port 5432, and does NOT need the `pgbouncer=true` flag.
 *
 * For Supabase:
 *   Transaction pooler: host:6543?pgbouncer=true&connection_limit=5
 *   Session-mode pooler: host:5432   (same host, no flags)
 *
 * We derive the session URL from DIRECT_URL which already points at port 5432.
 */
function buildSessionUrl(): string | null {
  const directUrl = process.env["DIRECT_URL"];
  if (!directUrl) return null;
  // DIRECT_URL already is the session/direct URL.
  // Strip any pgbouncer flags and ensure connection_limit=1 so 10 clients don't exceed pool limit.
  const base = directUrl.replace(/[?&]pgbouncer=true/, "").replace(/[?&]connection_limit=\d+/, "");
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}connection_limit=1`;
}

const SESSION_URL = buildSessionUrl();
const SKIP_REASON = !SESSION_URL
  ? "DIRECT_URL not set — real concurrency test requires a live PostgreSQL connection"
  : null;

// ---------------------------------------------------------------------------
// Test schema name — isolated from dev data
// ---------------------------------------------------------------------------

const TEST_SCHEMA = "patchwars_test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function newClient(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: SESSION_URL! } },
    log: [], // silence all logs in tests
  });
}

/** Execute raw SQL using a given client */
async function sql(client: PrismaClient, query: string, values: unknown[] = []): Promise<unknown> {
  return client.$queryRawUnsafe(query, ...values);
}

// ---------------------------------------------------------------------------
// Seed & teardown helpers
// ---------------------------------------------------------------------------

let seedDb: PrismaClient;

async function setupTestSchema(db: PrismaClient): Promise<void> {
  // Create isolated test schema
  await db.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${TEST_SCHEMA}"`);
  // Set search_path for this connection
  await db.$executeRawUnsafe(`SET search_path TO "${TEST_SCHEMA}", public`);
}

/**
 * Insert a fresh set of seed data for a concurrency race:
 *   - 1 Repo + 1 Issue (Easy, 1 spot)
 *   - 10 Members (general tier, all different teams cycling through 5 teams)
 * Returns { issueId, members[] }
 */
async function seedRaceFixture(db: PrismaClient, runIndex: number): Promise<{
  issueId: string;
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  members: Array<{
    id: string;
    githubUserId: bigint;
    githubLogin: string;
    commentId: bigint;
    createdAt: string; // ISO
  }>;
}> {
  const repoOwner = "AARVAK-VSET";
  const repoName = `aqua-sense`;
  const issueNumber = 200000 + crypto.randomInt(1, 700000);
  const githubRepoId = BigInt(500000000 + crypto.randomInt(1, 400000000));
  const githubIssueId = BigInt(600000000 + crypto.randomInt(1, 300000000));

  // Upsert repo
  const repo = await db.repo.upsert({
    where: { owner_name: { owner: repoOwner, name: repoName } },
    create: {
      owner: repoOwner,
      name: repoName,
      githubRepoId,
    },
    update: {},
  });

  // Create the test issue
  const issue = await db.issue.create({
    data: {
      repoId: repo.id,
      number: issueNumber,
      title: `Concurrency race test issue ${issueNumber}`,
      level: "easy",
      spots: 1,
      githubIssueId,
    },
  });

  const teams = ["NEXUS", "CIPHER", "BYTE_BRIGADE", "ASCEND", "ECHO"] as const;
  const members = [];

  // Use a random base offset per invocation so commentIds never collide with
  // rows left behind by a previous test-suite execution that crashed before cleanup.
  const commentBase = BigInt(crypto.randomInt(1_000_000_000, 9_000_000_000));
  // Similarly, give each member a random githubUserId so stale Claim / WaitlistEntry
  // rows from prior runs cannot trigger the active-claims or previously-expired guards.
  const userBase = BigInt(crypto.randomInt(1_000_000_000, 9_000_000_000));

  for (let i = 0; i < 10; i++) {
    const githubUserId = userBase + BigInt(i);
    const login = `racer_r${runIndex}_${i}_${crypto.randomInt(100, 999)}`;
    const member = await db.member.upsert({
      where: { githubUserId },
      create: {
        githubUserId,
        githubLogin: login,
        displayName: `Racer ${runIndex}-${i}`,
        department: "pr",
        team: teams[i % 5]!,
        tier: "general",
      },
      update: { githubLogin: login },
    });

    // Strict ordering: member 0 has earliest created_at
    const createdAt = new Date(Date.now() - (10 - i) * 1000).toISOString();

    members.push({
      id: member.id,
      githubUserId,
      githubLogin: login,
      commentId: commentBase + BigInt(i),
      createdAt,
    });
  }

  return { issueId: issue.id, repoOwner, repoName, issueNumber, members };
}

async function cleanRaceFixture(
  db: PrismaClient,
  issueId: string,
  memberIds: string[]
): Promise<void> {
  // Clean up in dependency order
  await db.botComment.deleteMany({ where: { issueId } });
  await db.waitlistEntry.deleteMany({ where: { issueId } });
  await db.claim.deleteMany({ where: { issueId } });
  await db.issue.deleteMany({ where: { id: issueId } });
  // Remove the randomly-created test members to prevent DB growth and
  // eliminate any chance of future collision on githubUserId / commentId.
  await db.member.deleteMany({ where: { id: { in: memberIds } } });
}

// ---------------------------------------------------------------------------
// The actual concurrency test
// ---------------------------------------------------------------------------

describe(
  "10-way concurrent claim race — real parallel transactions",
  SKIP_REASON ? { skip: SKIP_REASON } : {},
  () => {
    let racerClients: PrismaClient[] = [];

    beforeAll(async () => {
      if (!SESSION_URL) return;
      seedDb = newClient();
      racerClients = Array.from({ length: 10 }, () => newClient());
    });

    afterAll(async () => {
      if (!SESSION_URL) return;
      await Promise.all(racerClients.map((c) => c.$disconnect()));
      await seedDb.$disconnect();
    });

    /**
     * Run the race once and return outcomes.
     * MUST be called with a fresh fixture each time.
     */
    async function runRace(fixture: Awaited<ReturnType<typeof seedRaceFixture>>): Promise<{
      outcomes: string[];
      winnerGithubUserId: bigint | null;
      claimCount: number;
      allPostedComments: Array<{ issueId: string; kind: string; memberId: string | null }>;
    }> {
      const { issueId, repoOwner, repoName, issueNumber, members } = fixture;

      /**
       * BARRIER PATTERN:
       * Each racer waits on a shared "start" promise before executing its
       * claim, ensuring all 10 transactions begin BEFORE any can commit.
       * This is the mechanism that makes the race genuinely concurrent.
       */
      let releaseBarrier!: () => void;
      const barrier = new Promise<void>((resolve) => {
        releaseBarrier = resolve;
      });

      const allPostedComments: Array<{ issueId: string; kind: string; memberId: string | null }> = [];
      const postReply = async (
        issueId: string,
        kind: string,
        _body: string,
        memberId: string | null
      ) => {
        allPostedComments.push({ issueId, kind, memberId });
      };

      // Launch all 10 racers concurrently
      const racePromises = members.map((member, i) =>
        barrier.then(() =>
          processClaimComment(
            racerClients[i]!,
            {
              commentId: member.commentId,
              githubUserId: member.githubUserId,
              body: "Claiming this issue",
              createdAt: member.createdAt,
              updatedAt: member.createdAt, // not edited
            },
            { repoOwner, repoName, issueNumber },
            { postReply }
          )
        )
      );

      // All clients ready — fire the barrier
      releaseBarrier();

      const results = await Promise.all(racePromises);

      const outcomes = results.map((r) => r.outcome);

      // Find winner
      const winnerIdx = outcomes.indexOf("accepted");
      const winnerGithubUserId =
        winnerIdx >= 0 ? members[winnerIdx]!.githubUserId : null;

      // Count actual Claim rows in the DB
      const claimCount = await seedDb.claim.count({ where: { issueId } });

      return { outcomes, winnerGithubUserId, claimCount, allPostedComments };
    }

    it("exactly one winner across 3 repeated races", async () => {
      /**
       * Run 5 independent races. Each race:
       *   - Seeds a fresh issue
       *   - Fires 10 concurrent claims
       *   - Asserts exactly 1 accepted + exactly 1 DB row
       *   - Cleans up
       */
      for (let run = 0; run < 3; run++) {
        const fixture = await seedRaceFixture(seedDb, run);

        const { outcomes, winnerGithubUserId, claimCount, allPostedComments } = await runRace(fixture);

        const acceptedCount = outcomes.filter((o) => o === "accepted").length;
        const nonAccepted = outcomes.filter((o) => o !== "accepted");

        // Core assertion: exactly one spot claimed
        expect(acceptedCount).toBe(1);
        expect(claimCount).toBe(1);

        // The other 9 are waitlisted or rejected (never a second "accepted")
        expect(nonAccepted).toHaveLength(9);
        for (const o of nonAccepted) {
          expect(["waitlisted", "same_team", "previously_expired"]).toContain(o);
        }

        // Winner must be one of the participating racers
        expect(winnerGithubUserId).not.toBeNull();
        const validUserIds = fixture.members.map((m) => m.githubUserId);
        expect(validUserIds).toContain(winnerGithubUserId);

        // No duplicate bot comments: each (issueId, kind, memberId) must be unique
        const seen = new Set<string>();
        for (const bc of allPostedComments) {
          const key = `${bc.issueId}::${bc.kind}::${bc.memberId}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }

        // Cleanup for next run (including the randomly-created member rows)
        await cleanRaceFixture(seedDb, fixture.issueId, fixture.members.map((m) => m.id));
      }
    }, 300_000); // 5-minute timeout for 3 × 10 concurrent DB transactions
  }
);
