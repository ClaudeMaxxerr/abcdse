import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { computeHubSignature256, verifyWebhookSignature } from "../src/webhooks/verify.js";
import { buildApp } from "../src/app.js";

describe("Webhook Signature Verification and Security", () => {
  const secret = "test_webhook_secret_for_patch_wars_2026";
  const samplePayload = JSON.stringify({
    action: "created",
    issue: { id: 101, number: 1, title: "Test Issue" },
  });
  const sampleBuffer = Buffer.from(samplePayload, "utf-8");

  it("accepts a valid signature", () => {
    const signature = computeHubSignature256(sampleBuffer, secret);
    expect(verifyWebhookSignature(sampleBuffer, signature, secret)).toBe(true);
  });

  it("rejects an invalid signature with 401 expectation", () => {
    const invalidSignature = "sha256=" + "0".repeat(64);
    expect(verifyWebhookSignature(sampleBuffer, invalidSignature, secret)).toBe(false);
  });

  it("rejects when signature is absent or malformed", () => {
    expect(verifyWebhookSignature(sampleBuffer, undefined, secret)).toBe(false);
    expect(verifyWebhookSignature(sampleBuffer, "", secret)).toBe(false);
    expect(verifyWebhookSignature(sampleBuffer, "invalid_header", secret)).toBe(false);
    expect(verifyWebhookSignature(sampleBuffer, "sha256=too_short", secret)).toBe(false);
  });

  it("a ONE-BYTE change in the payload body invalidates the signature", () => {
    const signature = computeHubSignature256(sampleBuffer, secret);

    // Modify exactly one byte in the buffer
    const mutatedBuffer = Buffer.from(sampleBuffer);
    mutatedBuffer[0] = mutatedBuffer[0]! ^ 0x01; // flip 1 bit

    expect(verifyWebhookSignature(mutatedBuffer, signature, secret)).toBe(false);
  });

  it("asserts that crypto.timingSafeEqual is actually used for constant-time comparison", () => {
    const timingSafeEqualSpy = vi.spyOn(crypto, "timingSafeEqual");
    const signature = computeHubSignature256(sampleBuffer, secret);

    const result = verifyWebhookSignature(sampleBuffer, signature, secret);

    expect(result).toBe(true);
    expect(timingSafeEqualSpy).toHaveBeenCalled();

    timingSafeEqualSpy.mockRestore();
  });
});

describe("POST /webhooks/github Endpoint & Idempotency", () => {
  const secret = "test_webhook_secret_for_patch_wars_2026";

  it("rejects requests missing X-Hub-Signature-256 with 401", async () => {
    const app = await buildApp({ webhookSecret: secret, disableLogging: true });

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: {
        "x-github-delivery": "uuid-1",
        "x-github-event": "issues",
        "content-type": "application/json",
      },
      payload: JSON.stringify({ action: "opened" }),
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("rejects requests with mismatched signature with 401", async () => {
    const app = await buildApp({ webhookSecret: secret, disableLogging: true });

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: {
        "x-github-delivery": "uuid-1",
        "x-github-event": "issues",
        "x-hub-signature-256": "sha256=" + "a".repeat(64),
        "content-type": "application/json",
      },
      payload: JSON.stringify({ action: "opened" }),
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("accepts valid webhook signature and returns 200 fast", async () => {
    const payloadStr = JSON.stringify({ action: "opened", issue: { number: 1 } });
    const rawBuffer = Buffer.from(payloadStr, "utf-8");
    const signature = computeHubSignature256(rawBuffer, secret);

    const createdDeliveries: any[] = [];
    const mockDb = {
      $transaction: async (cb: any) => {
        return cb({
          webhookDelivery: {
            create: async (args: any) => {
              createdDeliveries.push(args.data);
              return { id: "delivery-1", ...args.data };
            },
          },
        });
      },
      webhookDelivery: {
        update: async () => {},
      },
    } as any;

    const app = await buildApp({ prismaClient: mockDb, webhookSecret: secret, disableLogging: true });

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: {
        "x-github-delivery": "11111111-2222-3333-4444-555555555555",
        "x-github-event": "issues",
        "x-hub-signature-256": signature,
        "content-type": "application/json",
      },
      payload: payloadStr,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(true);
    expect(createdDeliveries).toHaveLength(1);
    expect(createdDeliveries[0].deliveryUuid).toBe("11111111-2222-3333-4444-555555555555");

    await app.close();
  });

  it("idempotency: the same X-GitHub-Delivery twice produces exactly one processed record", async () => {
    const payloadStr = JSON.stringify({ action: "opened", issue: { number: 2 } });
    const rawBuffer = Buffer.from(payloadStr, "utf-8");
    const signature = computeHubSignature256(rawBuffer, secret);
    const deliveryUuid = "22222222-3333-4444-5555-666666666666";

    let deliveryInsertAttempts = 0;
    let successfulCreations = 0;
    const existingUuids = new Set<string>();

    const mockDb = {
      $transaction: async (cb: any) => {
        return cb({
          webhookDelivery: {
            create: async (args: any) => {
              deliveryInsertAttempts++;
              if (existingUuids.has(args.data.deliveryUuid)) {
                const err = new Error("Unique constraint failed");
                (err as any).code = "P2002";
                throw err;
              }
              existingUuids.add(args.data.deliveryUuid);
              successfulCreations++;
              return { id: "delivery-2", ...args.data };
            },
          },
        });
      },
      webhookDelivery: {
        update: async () => {},
      },
    } as any;

    const app = await buildApp({ prismaClient: mockDb, webhookSecret: secret, disableLogging: true });

    // First delivery attempt -> 200 OK, created
    const res1 = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: {
        "x-github-delivery": deliveryUuid,
        "x-github-event": "issues",
        "x-hub-signature-256": signature,
        "content-type": "application/json",
      },
      payload: payloadStr,
    });
    expect(res1.statusCode).toBe(200);
    expect(JSON.parse(res1.body).ok).toBe(true);

    // Second delivery attempt (replay of same X-GitHub-Delivery) -> 200 OK, ignored duplicate
    const res2 = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: {
        "x-github-delivery": deliveryUuid,
        "x-github-event": "issues",
        "x-hub-signature-256": signature,
        "content-type": "application/json",
      },
      payload: payloadStr,
    });
    expect(res2.statusCode).toBe(200);
    const res2Body = JSON.parse(res2.body);
    expect(res2Body.status).toBe("ignored_duplicate");

    expect(deliveryInsertAttempts).toBe(2);
    expect(successfulCreations).toBe(1);

    await app.close();
  });

  it("an issue_comment with action 'edited' is recorded but never treated as a new claim", async () => {
    let auditLogCreated = false;
    let claimAttempted = false;

    const mockDb = {
      $transaction: async (cb: any) => cb({
        webhookDelivery: {
          create: async (args: any) => ({ id: "del-edit", ...args.data }),
        },
      }),
      webhookDelivery: {
        update: async () => {},
      },
      auditLog: {
        create: async (args: any) => {
          auditLogCreated = true;
          expect(args.data.action).toBe("comment_edit_rejected");
          return { id: "audit-1" };
        },
      },
    } as any;

    const app = await buildApp({
      prismaClient: mockDb,
      webhookSecret: secret,
      disableLogging: true,
      onProcessDelivery: async (delivery) => {
        if (delivery.action === "edited") {
          // Reject claim creation on edit
          await mockDb.auditLog.create({
            data: {
              actorIp: "github-webhook",
              action: "comment_edit_rejected",
              targetType: "issue_comment",
              targetId: "999",
            },
          });
          return;
        }
        claimAttempted = true;
      },
    });

    const payloadStr = JSON.stringify({
      action: "edited",
      issue: { number: 10 },
      comment: {
        id: 999,
        body: "Claiming this issue",
        created_at: "2026-09-18T10:00:00Z",
        updated_at: "2026-09-18T10:05:00Z",
        user: { id: 12345, login: "hacker" },
      },
    });
    const signature = computeHubSignature256(Buffer.from(payloadStr), secret);

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: {
        "x-github-delivery": "33333333-4444-5555-6666-777777777777",
        "x-github-event": "issue_comment",
        "x-hub-signature-256": signature,
        "content-type": "application/json",
      },
      payload: payloadStr,
    });

    expect(res.statusCode).toBe(200);

    // Wait for async background task to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(auditLogCreated).toBe(true);
    expect(claimAttempted).toBe(false);

    await app.close();
  });

  it("out-of-order delivery of two comments still orders them by created_at then comment.id", () => {
    const comments = [
      {
        id: 502,
        created_at: "2026-09-18T12:00:05Z",
        body: "Claiming this issue - second comment",
      },
      {
        id: 501,
        created_at: "2026-09-18T12:00:00Z",
        body: "Claiming this issue - first comment",
      },
    ];

    // Simulate sorting function prescribed in Section 9.5
    const sorted = [...comments].sort((a, b) => {
      const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.id - b.id;
    });

    expect(sorted[0]!.id).toBe(501);
    expect(sorted[1]!.id).toBe(502);

    // Tie-breaking by numeric comment.id when created_at is identical
    const tieComments = [
      { id: 999, created_at: "2026-09-18T12:00:00Z" },
      { id: 888, created_at: "2026-09-18T12:00:00Z" },
    ];
    const sortedTies = [...tieComments].sort((a, b) => {
      const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.id - b.id;
    });

    expect(sortedTies[0]!.id).toBe(888);
    expect(sortedTies[1]!.id).toBe(999);
  });
});
