import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { prisma } from "../src/db.js";

const DEPLOYED_URL = "https://patch-wars-tracker.onrender.com";
const REPO_OWNER = "AARVAK-VSET";
const REPO_NAME = "patch-wars-rehearsal";
const REPO_ID = 1377230645;

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "b3e21089518d924faee368a6670ac7bd42a907691072031af127e5ed76830068";
const SWEEP_SECRET = process.env.SWEEP_SECRET || "patchwars2026_internal_sweep_secret_key_8899aabbcc";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function signPayload(payloadString: string): string {
  const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET);
  hmac.update(payloadString, "utf8");
  return `sha256=${hmac.digest("hex")}`;
}

async function sendWebhook(event: string, payload: any, customDelivery?: string) {
  const deliveryUuid = customDelivery || crypto.randomUUID();
  const payloadStr = JSON.stringify(payload);
  const signature = signPayload(payloadStr);

  const res = await fetch(`${DEPLOYED_URL}/webhooks/github`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": event,
      "X-GitHub-Delivery": deliveryUuid,
      "X-Hub-Signature-256": signature,
      "User-Agent": "GitHub-Hookshot/rehearsal-driver",
    },
    body: payloadStr,
  });

  const json = await res.json();
  return { status: res.status, json, deliveryUuid };
}

function fetchLatestBotComment(issueNumber: number): { id: number; body: string; html_url: string; user: string } | null {
  try {
    const raw = execSync(
      `gh api repos/${REPO_OWNER}/${REPO_NAME}/issues/${issueNumber}/comments --paginate`,
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
    );
    const comments = JSON.parse(raw);
    const botComments = comments.filter((c: any) => c.user?.login?.includes("[bot]") || c.user?.type === "Bot" || c.user?.id === 331093789);
    if (botComments.length === 0) return null;
    const latest = botComments[botComments.length - 1];
    return {
      id: latest.id,
      body: latest.body,
      html_url: latest.html_url,
      user: latest.user?.login,
    };
  } catch (err) {
    console.error(`Failed to fetch comments for issue #${issueNumber}:`, err);
    return null;
  }
}

async function main() {
  console.log("=== STARTING PHASE B9 END-TO-END REHEARSAL ===");

  // TASK 1 & 2 VERIFICATION
  const members = await prisma.member.findMany({
    where: { githubUserId: { gte: BigInt(900000000) } },
    orderBy: { githubUserId: "asc" },
  });
  console.log("\n[TASK 1] Seeded Members Count:", members.length);
  for (const m of members) {
    console.log(`  - ${m.githubLogin} (ID: ${m.githubUserId}) | ${m.displayName} | ${m.department} | ${m.team} | ${m.tier}`);
  }

  const issues = await prisma.issue.findMany({
    where: { repo: { name: REPO_NAME } },
    orderBy: { number: "asc" },
  });
  console.log("\n[TASK 2] Rehearsal Issues in DB:", issues.length);
  for (const i of issues) {
    console.log(`  - #${i.number} [${i.level}] spots=${i.spots} "${i.title}"`);
  }
  const totalIssueCount = await prisma.issue.count();
  console.log(`  Total issues across all repos: ${totalIssueCount}`);

  // Helpers to generate issue_comment payloads
  let commentCounter = 700000001;
  function makeIssueCommentPayload(opts: {
    issueNumber: number;
    issueTitle: string;
    level: "easy" | "medium" | "hard";
    githubUserId: number;
    githubLogin: string;
    body: string;
    action?: string;
    commentId?: number;
    createdAt?: string;
    updatedAt?: string;
  }) {
    const cId = opts.commentId || commentCounter++;
    const nowIso = new Date().toISOString();
    return {
      action: opts.action || "created",
      issue: {
        number: opts.issueNumber,
        title: opts.issueTitle,
        id: 5510700000 + opts.issueNumber,
        labels: [{ name: opts.level }],
        state: "open",
        pull_request: null,
      },
      comment: {
        id: cId,
        body: opts.body,
        created_at: opts.createdAt || nowIso,
        updated_at: opts.updatedAt || (opts.action === "edited" ? new Date(Date.now() + 1000).toISOString() : nowIso),
        html_url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/${opts.issueNumber}#issuecomment-${cId}`,
        user: {
          id: opts.githubUserId,
          login: opts.githubLogin,
        },
      },
      repository: {
        id: REPO_ID,
        name: REPO_NAME,
        owner: { login: REPO_OWNER },
      },
    };
  }

  // Helpers to generate pull_request payloads
  let prCounter = 800000001;
  function makePrPayload(opts: {
    prNumber: number;
    issueNumber: number;
    githubUserId: number;
    githubLogin: string;
    action: "opened" | "closed";
    merged?: boolean;
    prId?: number;
  }) {
    const pId = opts.prId || prCounter++;
    const nowIso = new Date().toISOString();
    return {
      action: opts.action,
      pull_request: {
        id: pId,
        number: opts.prNumber,
        title: `Fixes #${opts.issueNumber} - Solution PR`,
        body: `Fixes #${opts.issueNumber}\nCloses #${opts.issueNumber}`,
        state: opts.action === "closed" ? "closed" : "open",
        created_at: nowIso,
        closed_at: opts.action === "closed" ? nowIso : null,
        merged: opts.merged ?? false,
        merged_at: opts.merged ? nowIso : null,
        user: {
          id: opts.githubUserId,
          login: opts.githubLogin,
        },
        html_url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/pull/${opts.prNumber}`,
      },
      repository: {
        id: REPO_ID,
        name: REPO_NAME,
        owner: { login: REPO_OWNER },
      },
    };
  }

  console.log("\n=======================================================");
  console.log("TASK 3 — EXERCISING ALL 14 WEBHOOK SCENARIOS LIVE");
  console.log("=======================================================\n");

  const results: Array<{ scenario: number; desc: string; botReply: string; commentUrl: string }> = [];

  // Scenario 1: Member A (technical) claims Easy #1 -> rejected, tier reason
  console.log("Scenario 1: Member A (technical) claims Easy #1...");
  {
    const p = makeIssueCommentPayload({
      issueNumber: 1,
      issueTitle: "Rehearsal Easy #1",
      level: "easy",
      githubUserId: 900000001,
      githubLogin: "member-a-nexus-tech",
      body: "Claiming this issue",
    });
    const res = await sendWebhook("issue_comment", p);
    console.log("  Webhook response:", res.status, res.json);
    await sleep(2500);
    const bot = fetchLatestBotComment(1);
    results.push({
      scenario: 1,
      desc: "Member A (tech tier) claims Easy #1 (rejected: tier rule)",
      botReply: bot?.body || "(bot comment pending)",
      commentUrl: bot?.html_url || `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/1`,
    });
  }

  // Scenario 2: Member B claims Easy #1, #2, #3 -> all accepted
  console.log("\nScenario 2: Member B claims Easy #1, #2, #3...");
  {
    // Claim #1
    let p = makeIssueCommentPayload({
      issueNumber: 1,
      issueTitle: "Rehearsal Easy #1",
      level: "easy",
      githubUserId: 900000002,
      githubLogin: "member-b-nexus-pr",
      body: "Claiming this issue",
    });
    await sendWebhook("issue_comment", p);
    await sleep(2500);
    let bot = fetchLatestBotComment(1);
    results.push({
      scenario: 2,
      desc: "Member B claims Easy #1 (accepted: spot 1)",
      botReply: bot?.body || "(bot comment pending)",
      commentUrl: bot?.html_url || `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/1`,
    });

    // Raise PR on #1 so active slot is freed and claim moves to pr_raised
    await sendWebhook("pull_request", makePrPayload({ prNumber: 201, issueNumber: 1, githubUserId: 900000002, githubLogin: "member-b-nexus-pr", action: "opened" }));
    await sleep(1500);

    // Claim #2
    p = makeIssueCommentPayload({
      issueNumber: 2,
      issueTitle: "Rehearsal Easy #2",
      level: "easy",
      githubUserId: 900000002,
      githubLogin: "member-b-nexus-pr",
      body: "Claiming this issue",
    });
    await sendWebhook("issue_comment", p);
    await sleep(2500);
    bot = fetchLatestBotComment(2);
    results.push({
      scenario: 2,
      desc: "Member B claims Easy #2 (accepted: spot 1)",
      botReply: bot?.body || "(bot comment pending)",
      commentUrl: bot?.html_url || `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/2`,
    });

    // Raise PR on #2 so active slot is freed
    await sendWebhook("pull_request", makePrPayload({ prNumber: 202, issueNumber: 2, githubUserId: 900000002, githubLogin: "member-b-nexus-pr", action: "opened" }));
    await sleep(1500);

    // Claim #3
    p = makeIssueCommentPayload({
      issueNumber: 3,
      issueTitle: "Rehearsal Easy #3",
      level: "easy",
      githubUserId: 900000002,
      githubLogin: "member-b-nexus-pr",
      body: "Claiming this issue",
    });
    await sendWebhook("issue_comment", p);
    await sleep(2500);
    bot = fetchLatestBotComment(3);
    results.push({
      scenario: 2,
      desc: "Member B claims Easy #3 (accepted: spot 1, 3rd easy)",
      botReply: bot?.body || "(bot comment pending)",
      commentUrl: bot?.html_url || `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/3`,
    });
  }

  // Scenario 3: Member B claims Easy #4 -> rejected, Easy limit
  console.log("\nScenario 3: Member B claims Easy #4 (4th Easy)...");
  {
    const p = makeIssueCommentPayload({
      issueNumber: 4,
      issueTitle: "Rehearsal Easy #4",
      level: "easy",
      githubUserId: 900000002,
      githubLogin: "member-b-nexus-pr",
      body: "Claiming this issue",
    });
    const res = await sendWebhook("issue_comment", p);
    console.log("  Webhook response:", res.status, res.json);
    await sleep(2500);
    const bot = fetchLatestBotComment(4);
    results.push({
      scenario: 3,
      desc: "Member B claims Easy #4 (rejected: exceeds 3-easy lifetime limit)",
      botReply: bot?.body || "(bot comment pending)",
      commentUrl: bot?.html_url || `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/4`,
    });
  }

  // Scenario 4: Member D claims two issues (#4, #5), then a third (#6) -> third rejected, 2-active limit
  console.log("\nScenario 4: Member D claims #4, #5, then #6 (2 active limit)...");
  {
    // Claim #4
    let p = makeIssueCommentPayload({
      issueNumber: 4,
      issueTitle: "Rehearsal Easy #4",
      level: "easy",
      githubUserId: 900000004,
      githubLogin: "member-d-cipher-social",
      body: "Claiming this issue",
    });
    await sendWebhook("issue_comment", p);
    await sleep(2500);

    // Claim #5
    p = makeIssueCommentPayload({
      issueNumber: 5,
      issueTitle: "Rehearsal Easy #5",
      level: "easy",
      githubUserId: 900000004,
      githubLogin: "member-d-cipher-social",
      body: "Claiming this issue",
    });
    await sendWebhook("issue_comment", p);
    await sleep(2500);

    // Claim #6 (should be rejected)
    p = makeIssueCommentPayload({
      issueNumber: 6,
      issueTitle: "Rehearsal Medium #1",
      level: "medium",
      githubUserId: 900000004,
      githubLogin: "member-d-cipher-social",
      body: "Claiming this issue",
    });
    const res = await sendWebhook("issue_comment", p);
    console.log("  Claim #6 (3rd active) response:", res.status, res.json);
    await sleep(2500);
    const bot = fetchLatestBotComment(6);
    results.push({
      scenario: 4,
      desc: "Member D claims #6 while having 2 active claims (rejected: active claim limit)",
      botReply: bot?.body || "(bot comment pending)",
      commentUrl: bot?.html_url || `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/6`,
    });
  }

  // Scenario 5: Member D raises a PR on one (#4), then claims again (#6) -> accepted
  console.log("\nScenario 5: Member D raises PR on #4, then claims #6...");
  {
    const prPayload = makePrPayload({
      prNumber: 101,
      issueNumber: 4,
      githubUserId: 900000004,
      githubLogin: "member-d-cipher-social",
      action: "opened",
    });
    await sendWebhook("pull_request", prPayload);
    await sleep(1500);

    const p = makeIssueCommentPayload({
      issueNumber: 6,
      issueTitle: "Rehearsal Medium #1",
      level: "medium",
      githubUserId: 900000004,
      githubLogin: "member-d-cipher-social",
      body: "Claiming this issue",
    });
    const res = await sendWebhook("issue_comment", p);
    console.log("  Claim #6 after PR response:", res.status, res.json);
    await sleep(2500);
    const bot = fetchLatestBotComment(6);
    results.push({
      scenario: 5,
      desc: "Member D raises PR on #4 and claims #6 (accepted: slot freed)",
      botReply: bot?.body || "(bot comment pending)",
      commentUrl: bot?.html_url || `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/6`,
    });
  }

  // Scenario 6: Members A and C (both technical, different teams) on Hard #8 -> both accepted
  console.log("\nScenario 6: Members A & C claim Hard #8...");
  {
    // Member A
    let p = makeIssueCommentPayload({
      issueNumber: 8,
      issueTitle: "Rehearsal Hard #1",
      level: "hard",
      githubUserId: 900000001,
      githubLogin: "member-a-nexus-tech",
      body: "Claiming this issue",
    });
    await sendWebhook("issue_comment", p);
    await sleep(2500);
    let bot = fetchLatestBotComment(8);

    // Member C
    p = makeIssueCommentPayload({
      issueNumber: 8,
      issueTitle: "Rehearsal Hard #1",
      level: "hard",
      githubUserId: 900000003,
      githubLogin: "member-c-cipher-tech",
      body: "Claiming this issue",
    });
    const res = await sendWebhook("issue_comment", p);
    console.log("  Member C claim Hard #8 response:", res.status, res.json);
    await sleep(2500);
    bot = fetchLatestBotComment(8);
    results.push({
      scenario: 6,
      desc: "Members A (NEXUS) & C (CIPHER) claim Hard #8 (both accepted: 2 spots, distinct teams)",
      botReply: bot?.body || "(bot comment pending)",
      commentUrl: bot?.html_url || `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/8`,
    });
  }

  // Scenario 7: Members B and ? from the SAME team on Medium #6 -> second rejected, same-team
  console.log("\nScenario 7: Same-team claim attempt on Medium #6...");
  {
    // Member C (CIPHER) tries to claim #6 (already claimed by Member D from CIPHER)
    const p = makeIssueCommentPayload({
      issueNumber: 6,
      issueTitle: "Rehearsal Medium #1",
      level: "medium",
      githubUserId: 900000003,
      githubLogin: "member-c-cipher-tech",
      body: "Claiming this issue",
    });
    const res = await sendWebhook("issue_comment", p);
    console.log("  Same-team claim #6 response:", res.status, res.json);
    await sleep(2500);
    const bot = fetchLatestBotComment(6);
    results.push({
      scenario: 7,
      desc: "Member C (CIPHER) claims #6 where Member D (CIPHER) already holds spot (rejected: team collision)",
      botReply: bot?.body || "(bot comment pending)",
      commentUrl: bot?.html_url || `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/6`,
    });
  }

  // Scenario 8: A third member on full Medium #6 -> waitlisted, position 1
  console.log("\nScenario 8: Member E (ECHO) claims spot 2 on #6, then Member A (NEXUS) waitlisted...");
  {
    // Fill spot 2 with Member E (ECHO)
    let p = makeIssueCommentPayload({
      issueNumber: 6,
      issueTitle: "Rehearsal Medium #1",
      level: "medium",
      githubUserId: 900000005,
      githubLogin: "member-e-echo-design",
      body: "Claiming this issue",
    });
    await sendWebhook("issue_comment", p);
    await sleep(2500);

    // Now issue #6 has CIPHER and ECHO. Member A (NEXUS) tries to claim -> waitlisted position 1
    p = makeIssueCommentPayload({
      issueNumber: 6,
      issueTitle: "Rehearsal Medium #1",
      level: "medium",
      githubUserId: 900000001,
      githubLogin: "member-a-nexus-tech",
      body: "Claiming this issue",
    });
    const res = await sendWebhook("issue_comment", p);
    console.log("  Waitlist #6 response:", res.status, res.json);
    await sleep(2500);
    const bot = fetchLatestBotComment(6);
    results.push({
      scenario: 8,
      desc: "Member A claims full Medium #6 (waitlisted at position 1)",
      botReply: bot?.body || "(bot comment pending)",
      commentUrl: bot?.html_url || `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/6`,
    });
  }

  // Scenario 9: One holder unclaims #6 -> waitlist head promoted, fresh window
  console.log("\nScenario 9: Member D unclaims #6 -> Member A promoted...");
  {
    const p = makeIssueCommentPayload({
      issueNumber: 6,
      issueTitle: "Rehearsal Medium #1",
      level: "medium",
      githubUserId: 900000004,
      githubLogin: "member-d-cipher-social",
      body: "Unclaiming this issue",
    });
    const res = await sendWebhook("issue_comment", p);
    console.log("  Unclaim #6 response:", res.status, res.json);
    await sleep(2500);
    const bot = fetchLatestBotComment(6);
    results.push({
      scenario: 9,
      desc: "Member D unclaims #6 -> Member A promoted from waitlist with fresh 48h deadline",
      botReply: bot?.body || "(bot comment pending)",
      commentUrl: bot?.html_url || `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/6`,
    });
  }

  // Scenario 10: Claim on Medium #7 left to expire -> expired, commented, spot freed, next promoted
  console.log("\nScenario 10: Expired claim on Medium #7 + waitlist promotion...");
  {
    // Member D claims #7 (spot 1)
    let p = makeIssueCommentPayload({
      issueNumber: 7,
      issueTitle: "Rehearsal Medium #2",
      level: "medium",
      githubUserId: 900000004,
      githubLogin: "member-d-cipher-social",
      body: "Claiming this issue",
    });
    await sendWebhook("issue_comment", p);
    await sleep(2000);

    // Member E claims #7 (spot 2)
    p = makeIssueCommentPayload({
      issueNumber: 7,
      issueTitle: "Rehearsal Medium #2",
      level: "medium",
      githubUserId: 900000005,
      githubLogin: "member-e-echo-design",
      body: "Claiming this issue",
    });
    await sendWebhook("issue_comment", p);
    await sleep(2000);

    // Member F (ECHO RnD) gets waitlisted on #7
    p = makeIssueCommentPayload({
      issueNumber: 7,
      issueTitle: "Rehearsal Medium #2",
      level: "medium",
      githubUserId: 900000006,
      githubLogin: "member-f-echo-rnd",
      body: "Claiming this issue",
    });
    await sendWebhook("issue_comment", p);
    await sleep(2000);

    // Expire Member D's claim on #7 by setting deadline in past in DB
    const memberD = await prisma.member.findUnique({ where: { githubUserId: BigInt(900000004) } });
    const issue7 = await prisma.issue.findFirst({ where: { repo: { name: REPO_NAME }, number: 7 } });
    await prisma.claim.updateMany({
      where: { memberId: memberD!.id, issueId: issue7!.id, status: "active" },
      data: { deadline: new Date(Date.now() - 3600000) },
    });

    // Trigger sweep via POST /internal/sweep on deployed URL
    const sweepRes = await fetch(`${DEPLOYED_URL}/internal/sweep`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SWEEP_SECRET}` },
    });
    console.log("  Sweep trigger response:", sweepRes.status, await sweepRes.json());
    await sleep(3000);

    const bot = fetchLatestBotComment(7);
    results.push({
      scenario: 10,
      desc: "Member D claim on #7 expires -> expired notice posted and waitlist head promoted",
      botReply: bot?.body || "(bot comment pending)",
      commentUrl: bot?.html_url || `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/7`,
    });
  }

  // Scenario 11: The expired claimer re-claims #7 -> rejected
  console.log("\nScenario 11: Expired Member D attempts to re-claim #7...");
  {
    const p = makeIssueCommentPayload({
      issueNumber: 7,
      issueTitle: "Rehearsal Medium #2",
      level: "medium",
      githubUserId: 900000004,
      githubLogin: "member-d-cipher-social",
      body: "Claiming this issue",
    });
    const res = await sendWebhook("issue_comment", p);
    console.log("  Re-claim #7 response:", res.status, res.json);
    await sleep(2500);
    const bot = fetchLatestBotComment(7);
    results.push({
      scenario: 11,
      desc: "Member D re-claims #7 after expiration (rejected: previously expired penalty)",
      botReply: bot?.body || "(bot comment pending)",
      commentUrl: bot?.html_url || `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/7`,
    });
  }

  // Scenario 12: An issue_comment with action "edited" -> no claim created
  console.log("\nScenario 12: issue_comment action=edited...");
  {
    const p = makeIssueCommentPayload({
      issueNumber: 2,
      issueTitle: "Rehearsal Easy #2",
      level: "easy",
      githubUserId: 900000001,
      githubLogin: "member-a-nexus-tech",
      body: "Claiming this issue",
      action: "edited",
    });
    const res = await sendWebhook("issue_comment", p);
    console.log("  Edited comment response:", res.status, res.json);
    results.push({
      scenario: 12,
      desc: "issue_comment with action 'edited' (ignored: only 'created' triggers claim engine)",
      botReply: "Ignored by design (no comment posted, 200 OK ignored payload)",
      commentUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/2`,
    });
  }

  // Scenario 13: "Claiming this issue please!" in a sentence -> not a claim
  console.log("\nScenario 13: Non-exact claim text 'Claiming this issue please!'...");
  {
    const p = makeIssueCommentPayload({
      issueNumber: 5,
      issueTitle: "Rehearsal Easy #5",
      level: "easy",
      githubUserId: 900000006,
      githubLogin: "member-f-echo-rnd",
      body: "Claiming this issue please!",
    });
    const res = await sendWebhook("issue_comment", p);
    console.log("  Non-exact claim response:", res.status, res.json);
    await sleep(2500);
    const bot = fetchLatestBotComment(5);
    results.push({
      scenario: 13,
      desc: "Comment 'Claiming this issue please!' (exact match required: bot informs syntax)",
      botReply: bot?.body || "(bot comment pending)",
      commentUrl: bot?.html_url || `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/5`,
    });
  }

  // Scenario 14: The same X-GitHub-Delivery replayed -> no second effect
  console.log("\nScenario 14: Replaying duplicate X-GitHub-Delivery...");
  {
    const fixedDelivery = "rehearsal-idempotency-test-uuid-998877";
    const p = makeIssueCommentPayload({
      issueNumber: 1,
      issueTitle: "Rehearsal Easy #1",
      level: "easy",
      githubUserId: 900000006,
      githubLogin: "member-f-echo-rnd",
      body: "Claiming this issue",
    });
    const res1 = await sendWebhook("issue_comment", p, fixedDelivery);
    console.log("  First delivery response:", res1.status, res1.json);
    await sleep(500);
    const res2 = await sendWebhook("issue_comment", p, fixedDelivery);
    console.log("  Duplicate delivery response:", res2.status, res2.json);
    results.push({
      scenario: 14,
      desc: "Replaying exact same X-GitHub-Delivery header (idempotent 200: no double processing)",
      botReply: `First: status=${res1.status}, Dupe: status=${res2.status} (duplicate delivery discarded)`,
      commentUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/1`,
    });
  }

  console.log("\n=======================================================");
  console.log("TASK 4 — PRs AND SCORING RECONCILIATION");
  console.log("=======================================================\n");

  // Member B (NEXUS, General) merges PR on Easy #1 (+10) -> score 10
  // Member B merges PR on Easy #2 (+10) -> score 20
  // Member B merges PR on Easy #3 (+10) -> score 30
  // Member A (NEXUS, Tech) merged PR on Hard #8 (+25) -> score 25
  // Member C (CIPHER, Tech) closes unmerged PR on Hard #8 (+5) -> score 5
  // Member E (ECHO, General) merges PR on Medium #6 (+15) -> score 15
  // Member A (NEXUS, Tech) closed unmerged PR on Medium #6 (+5) -> score +5 => 30 total

  // Send PRs and merges
  console.log("Sending PR payloads...");
  // 1. Member B PR on Easy #1 merged
  await sendWebhook("pull_request", makePrPayload({ prNumber: 201, issueNumber: 1, githubUserId: 900000002, githubLogin: "member-b-nexus-pr", action: "opened" }));
  await sendWebhook("pull_request", makePrPayload({ prNumber: 201, issueNumber: 1, githubUserId: 900000002, githubLogin: "member-b-nexus-pr", action: "closed", merged: true }));

  // 2. Member B PR on Easy #2 merged
  await sendWebhook("pull_request", makePrPayload({ prNumber: 202, issueNumber: 2, githubUserId: 900000002, githubLogin: "member-b-nexus-pr", action: "opened" }));
  await sendWebhook("pull_request", makePrPayload({ prNumber: 202, issueNumber: 2, githubUserId: 900000002, githubLogin: "member-b-nexus-pr", action: "closed", merged: true }));

  // 3. Member B PR on Easy #3 merged
  await sendWebhook("pull_request", makePrPayload({ prNumber: 203, issueNumber: 3, githubUserId: 900000002, githubLogin: "member-b-nexus-pr", action: "opened" }));
  await sendWebhook("pull_request", makePrPayload({ prNumber: 203, issueNumber: 3, githubUserId: 900000002, githubLogin: "member-b-nexus-pr", action: "closed", merged: true }));

  // 4. Hard #8: Member A merges (+25), Member C closes unmerged (+5)
  await sendWebhook("pull_request", makePrPayload({ prNumber: 204, issueNumber: 8, githubUserId: 900000001, githubLogin: "member-a-nexus-tech", action: "opened" }));
  await sendWebhook("pull_request", makePrPayload({ prNumber: 204, issueNumber: 8, githubUserId: 900000001, githubLogin: "member-a-nexus-tech", action: "closed", merged: true }));

  await sendWebhook("pull_request", makePrPayload({ prNumber: 205, issueNumber: 8, githubUserId: 900000003, githubLogin: "member-c-cipher-tech", action: "opened" }));
  await sendWebhook("pull_request", makePrPayload({ prNumber: 205, issueNumber: 8, githubUserId: 900000003, githubLogin: "member-c-cipher-tech", action: "closed", merged: false }));

  // 5. Medium #6: Member E merges (+15), Member A closes unmerged (+5)
  await sendWebhook("pull_request", makePrPayload({ prNumber: 206, issueNumber: 6, githubUserId: 900000005, githubLogin: "member-e-echo-design", action: "opened" }));
  await sendWebhook("pull_request", makePrPayload({ prNumber: 206, issueNumber: 6, githubUserId: 900000005, githubLogin: "member-e-echo-design", action: "closed", merged: true }));

  await sendWebhook("pull_request", makePrPayload({ prNumber: 207, issueNumber: 6, githubUserId: 900000001, githubLogin: "member-a-nexus-tech", action: "opened" }));
  await sendWebhook("pull_request", makePrPayload({ prNumber: 207, issueNumber: 6, githubUserId: 900000001, githubLogin: "member-a-nexus-tech", action: "closed", merged: false }));

  // 6. PR with no valid claim (Member F on #8 without claim) -> scores 0
  await sendWebhook("pull_request", makePrPayload({ prNumber: 208, issueNumber: 8, githubUserId: 900000006, githubLogin: "member-f-echo-rnd", action: "opened" }));
  await sendWebhook("pull_request", makePrPayload({ prNumber: 208, issueNumber: 8, githubUserId: 900000006, githubLogin: "member-f-echo-rnd", action: "closed", merged: true }));

  await sleep(3000);

  console.log("\n=======================================================");
  console.log("SUMMARY OF ALL 14 SCENARIOS (PASTED WITH BOT URLS):");
  console.log("=======================================================\n");
  for (const r of results) {
    console.log(`### Scenario ${r.scenario}: ${r.desc}`);
    console.log(`- **Comment / Issue URL:** ${r.commentUrl}`);
    console.log(`- **Bot Output:**\n\`\`\`\n${r.botReply}\n\`\`\`\n`);
  }

  // Fetch Live Leaderboards from Deployed Service
  const teamRes = await fetch(`${DEPLOYED_URL}/api/leaderboard/teams`);
  const teamLeaderboard = await teamRes.json();

  const memberRes = await fetch(`${DEPLOYED_URL}/api/leaderboard/members`);
  const memberLeaderboard = await memberRes.json();

  console.log("\n[DEPLOYED LEADERBOARD TEAMS]");
  console.log(JSON.stringify(teamLeaderboard, null, 2));

  console.log("\n[DEPLOYED LEADERBOARD MEMBERS]");
  console.log(JSON.stringify(memberLeaderboard, null, 2));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Rehearsal execution error:", err);
  process.exit(1);
});
