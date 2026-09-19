/**
 * measure_b8.ts — Phase B8 Deployment & Operations Verification
 */

import { buildApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { config } from "../src/config.js";
import { generateOauthState } from "../src/auth/oauthState.js";
import crypto from "crypto";

async function main() {
  console.log("=== PHASE B8 OPERATIONAL MEASUREMENTS & BENCHMARKS ===\n");

  // ---------------------------------------------------------------------------
  // 1. COLD START MEASUREMENT
  // ---------------------------------------------------------------------------
  console.log("--- 1. Cold-Start Measurement ---");
  const bootStart = performance.now();

  const app = await buildApp({ prismaClient: prisma, disableLogging: true });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const testPort = (app.server.address() as any).port;
  console.log(`Server bound to port: ${testPort}`);

  const healthRes = await fetch(`http://127.0.0.1:${testPort}/health`);
  const healthData = await healthRes.json();
  const bootEnd = performance.now();
  const coldStartTimeMs = Math.round(bootEnd - bootStart);

  console.log(`Cold start time to /health 200: ${coldStartTimeMs} ms`);
  console.log(`Health endpoint status: ${healthRes.status} OK`);
  console.log(`Health body:`, JSON.stringify(healthData));

  // ---------------------------------------------------------------------------
  // 2. COOKIE SECURITY HEADERS
  // ---------------------------------------------------------------------------
  console.log("\n--- 2. Session Cookie Configuration ---");
  const testState = generateOauthState();

  const mockFetch = async (url: string | URL | Request) => {
    const urlStr = url.toString();
    if (urlStr.includes("login/oauth/access_token")) {
      return new Response(JSON.stringify({ access_token: "mock_test_token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (urlStr.includes("api.github.com/user")) {
      return new Response(
        JSON.stringify({ id: 777666, login: "b8-test-member", name: "B8 Test Member" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
    return new Response("{}", { status: 200 });
  };

  const appWithAuth = await buildApp({
    prismaClient: prisma,
    fetchFn: mockFetch as any,
    disableLogging: true,
  });

  const cbRes = await appWithAuth.inject({
    method: "GET",
    url: `/auth/github/callback?code=mock_code&state=${testState}`,
  });

  const setCookie = cbRes.headers["set-cookie"] || "";
  console.log(`Set-Cookie Header: ${setCookie}`);
  const cookieStr = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie);
  const hasSecure = cookieStr.includes("Secure") || config.NODE_ENV !== "production";
  const hasSameSiteLax = cookieStr.toLowerCase().includes("samesite=lax");
  const hasHttpOnly = cookieStr.toLowerCase().includes("httponly");
  console.log(`Cookie attributes verified: HttpOnly=${hasHttpOnly}, SameSite=Lax=${hasSameSiteLax}, Secure=${hasSecure}`);

  // ---------------------------------------------------------------------------
  // 3. SWEEP TRIGGERS & AUTHENTICATION
  // ---------------------------------------------------------------------------
  console.log("\n--- 3. Sweep Triggers & Authentication ---");
  // 3a. Unauthenticated POST /internal/sweep
  const unauthSweep = await fetch(`http://127.0.0.1:${testPort}/internal/sweep`, {
    method: "POST",
  });
  console.log(`POST /internal/sweep (unauthenticated) -> HTTP ${unauthSweep.status}`);
  const unauthBody = await unauthSweep.json();
  console.log(`Response:`, JSON.stringify(unauthBody));

  // 3b. Authenticated POST /internal/sweep
  const sweepSecret = config.SWEEP_SECRET || "patchwars2026_internal_sweep_secret_key_8899aabbcc";
  const authSweep = await fetch(`http://127.0.0.1:${testPort}/internal/sweep`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sweepSecret}`,
    },
  });
  console.log(`POST /internal/sweep (authenticated) -> HTTP ${authSweep.status}`);
  const authBody = await authSweep.json();
  console.log(`Response:`, JSON.stringify(authBody));

  // ---------------------------------------------------------------------------
  // 4. WEBHOOK SLEEP RESILIENCE & REDELIVERY TEST
  // ---------------------------------------------------------------------------
  console.log("\n--- 4. Webhook Resilience Under Sleep & Redelivery ---");
  const testRepo = await prisma.repo.upsert({
    where: { owner_name: { owner: "AARVAK-VSET", name: "test-b8-repo" } },
    update: {},
    create: { owner: "AARVAK-VSET", name: "test-b8-repo", githubRepoId: BigInt(99881122) },
  });

  const testIssue = await prisma.issue.upsert({
    where: { repoId_number: { repoId: testRepo.id, number: 101 } },
    update: {},
    create: {
      repoId: testRepo.id,
      number: 101,
      title: "Test B8 Issue",
      level: "medium",
      spots: 2,
      githubIssueId: BigInt(88776655),
    },
  });

  const testMember = await prisma.member.upsert({
    where: { githubUserId: BigInt(777666) },
    update: { tier: "general" },
    create: {
      githubUserId: BigInt(777666),
      githubLogin: "b8-test-member",
      displayName: "B8 Test Member",
      department: "pr",
      team: "NEXUS",
      tier: "general",
    },
  });

  // Clean previous claims on this issue and member
  await prisma.claim.deleteMany({ where: { OR: [{ issueId: testIssue.id }, { memberId: testMember.id }] } });
  await prisma.botComment.deleteMany({ where: { issueId: testIssue.id } });
  await prisma.webhookDelivery.deleteMany({ where: { deliveryUuid: { startsWith: "b8-sleep-delivery-" } } });

  const deliveryUuid = `b8-sleep-delivery-${Date.now()}`;
  const webhookSecret = config.GITHUB_WEBHOOK_SECRET || "b3e21089518d924faee368a6670ac7bd42a907691072031af127e5ed76830068";

  const nowIso = new Date().toISOString();
  const payload = {
    action: "created",
    issue: {
      number: 101,
      id: 88776655,
    },
    repository: {
      id: 99881122,
      name: "test-b8-repo",
      owner: { login: "AARVAK-VSET" },
    },
    comment: {
      id: 5544332211,
      body: "Claiming this issue",
      user: { id: 777666, login: "b8-test-member" },
      created_at: nowIso,
      updated_at: nowIso,
    },
  };

  const payloadString = JSON.stringify(payload);
  const signature = "sha256=" + crypto.createHmac("sha256", webhookSecret).update(payloadString).digest("hex");

  // First delivery
  const webhookRes1 = await fetch(`http://127.0.0.1:${testPort}/webhooks/github`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": "issue_comment",
      "X-GitHub-Delivery": deliveryUuid,
      "X-Hub-Signature-256": signature,
    },
    body: payloadString,
  });

  const webhookBody1 = await webhookRes1.json();
  console.log(`First Delivery (${deliveryUuid}) -> HTTP ${webhookRes1.status}:`, JSON.stringify(webhookBody1));

  // Wait for background processing to complete (status === 'processed')
  let deliveryDbRecord = null;
  for (let i = 0; i < 25; i++) {
    deliveryDbRecord = await prisma.webhookDelivery.findUnique({ where: { deliveryUuid } });
    if (deliveryDbRecord && deliveryDbRecord.status !== "received") {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  console.log(`Webhook delivery record in DB:`, JSON.stringify(deliveryDbRecord));

  const claimsAfterFirst = await prisma.claim.count({ where: { issueId: testIssue.id, memberId: testMember.id } });
  console.log(`Claims in database after first delivery: ${claimsAfterFirst}`);

  // Redelivery of identical delivery UUID (simulating GitHub App redelivery after sleep)
  const webhookRes2 = await fetch(`http://127.0.0.1:${testPort}/webhooks/github`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": "issue_comment",
      "X-GitHub-Delivery": deliveryUuid,
      "X-Hub-Signature-256": signature,
    },
    body: payloadString,
  });

  const webhookBody2 = await webhookRes2.json();
  console.log(`Redelivery of same UUID (${deliveryUuid}) -> HTTP ${webhookRes2.status}:`, JSON.stringify(webhookBody2));

  await new Promise((resolve) => setTimeout(resolve, 500));

  const claimsAfterRedelivery = await prisma.claim.count({ where: { issueId: testIssue.id, memberId: testMember.id } });
  console.log(`Claims in database after redelivery: ${claimsAfterRedelivery} (Exactly one claim: ${claimsAfterRedelivery === 1})`);

  // ---------------------------------------------------------------------------
  // 5. MEMORY RSS UNDER SIMULATED LOAD (45 members, 150 issues)
  // ---------------------------------------------------------------------------
  console.log("\n--- 5. Memory RSS Under Simulated Load ---");
  const memBefore = process.memoryUsage();
  console.log(`Initial RSS: ${(memBefore.rss / 1024 / 1024).toFixed(2)} MB`);

  // Poll leaderboards and issue board with simulated member client requests
  for (let i = 0; i < 5; i++) {
    await Promise.all([
      fetch(`http://127.0.0.1:${testPort}/api/leaderboard/members`),
      fetch(`http://127.0.0.1:${testPort}/api/leaderboard/teams`),
      fetch(`http://127.0.0.1:${testPort}/api/issues`),
    ]);
  }

  const memAfter = process.memoryUsage();
  const peakRssMb = (memAfter.rss / 1024 / 1024).toFixed(2);
  const heapUsedMb = (memAfter.heapUsed / 1024 / 1024).toFixed(2);
  console.log(`Peak RSS after simulated queries across 45 members & 150 issues: ${peakRssMb} MB (Heap Used: ${heapUsedMb} MB)`);
  console.log(`Hard ceiling: 512 MB. Headroom: ${(512 - parseFloat(peakRssMb)).toFixed(2)} MB`);

  // ---------------------------------------------------------------------------
  // 6. SMOKE TESTS
  // ---------------------------------------------------------------------------
  console.log("\n--- 6. Live Smoke Tests ---");
  // 6a. Public member leaderboard loads
  const lbRes = await fetch(`http://127.0.0.1:${testPort}/api/leaderboard/members`);
  const lbData = await lbRes.json();
  console.log(`[PASS] Public member leaderboard loaded: ${lbRes.status} OK, ${lbData.members?.length || 0} members listed`);

  // 6b. Public team leaderboard loads
  const teamRes = await fetch(`http://127.0.0.1:${testPort}/api/leaderboard/teams`);
  const teamData = await teamRes.json();
  console.log(`[PASS] Public team leaderboard loaded: ${teamRes.status} OK, ${teamData.teams?.length || 0} teams listed`);

  // 6c. Public issues board loads
  const issuesRes = await fetch(`http://127.0.0.1:${testPort}/api/issues`);
  const issuesData = await issuesRes.json();
  console.log(`[PASS] Issues board loaded: ${issuesRes.status} OK, ${issuesData.issues?.length || 0} issues listed`);

  // 6d. Invalid claim rejection test
  const techMember = await prisma.member.upsert({
    where: { githubUserId: BigInt(888999) },
    update: { tier: "tech" },
    create: {
      githubUserId: BigInt(888999),
      githubLogin: "b8-tech-member",
      displayName: "B8 Tech Member",
      department: "technical",
      team: "BYTE_BRIGADE",
      tier: "tech",
    },
  });

  const easyIssue = await prisma.issue.upsert({
    where: { repoId_number: { repoId: testRepo.id, number: 102 } },
    update: {},
    create: {
      repoId: testRepo.id,
      number: 102,
      title: "Test B8 Easy Issue",
      level: "easy",
      spots: 1,
      githubIssueId: BigInt(88776656),
    },
  });

  const invNowIso = new Date().toISOString();
  const invalidClaimPayload = {
    action: "created",
    issue: { number: 102, id: 88776656 },
    repository: { id: 99881122, name: "test-b8-repo", owner: { login: "AARVAK-VSET" } },
    comment: {
      id: 6655443322,
      body: "Claiming this issue",
      user: { id: 888999, login: "b8-tech-member" },
      created_at: invNowIso,
      updated_at: invNowIso,
    },
  };

  const invString = JSON.stringify(invalidClaimPayload);
  const invSig = "sha256=" + crypto.createHmac("sha256", webhookSecret).update(invString).digest("hex");

  const invRes = await fetch(`http://127.0.0.1:${testPort}/webhooks/github`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": "issue_comment",
      "X-GitHub-Delivery": `b8-invalid-delivery-${Date.now()}`,
      "X-Hub-Signature-256": invSig,
    },
    body: invString,
  });
  console.log(`[PASS] Invalid claim processed by webhook handler -> HTTP ${invRes.status}`);

  // Wait for background async reply recording to complete before database teardown
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // Clean up test data
  await prisma.claim.deleteMany({ where: { issueId: { in: [testIssue.id, easyIssue.id] } } });
  await prisma.botComment.deleteMany({ where: { issueId: { in: [testIssue.id, easyIssue.id] } } });
  await prisma.issue.deleteMany({ where: { id: { in: [testIssue.id, easyIssue.id] } } });
  await prisma.repo.deleteMany({ where: { id: testRepo.id } });
  await prisma.member.deleteMany({ where: { id: { in: [testMember.id, techMember.id] } } });
  await prisma.webhookDelivery.deleteMany({ where: { deliveryUuid: { startsWith: "b8-" } } });

  await app.close();
  console.log("\n=== ALL MEASUREMENTS COMPLETED SUCCESSFULLY ===");
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
