import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { verifyWebhookSignature } from "./verify.js";
import { processClaimComment, processUnclaimComment, parseClaimIntent } from "../domain/claimEngine.js";
import { processPullRequestOpened, processPullRequestClosed } from "../domain/prEngine.js";
import { postBotComment } from "../github/comments.js";
import { runOpportunisticSweep, runExpirySweep } from "../domain/expirySweep.js";

export interface GitHubWebhookPayload {
  action?: string;
  issue?: {
    id: number;
    number: number;
    title: string;
  };
  comment?: {
    id: number;
    body: string;
    created_at: string;
    updated_at: string;
    user: {
      id: number;
      login: string;
    };
  };
  pull_request?: {
    id: number;
    number: number;
    title: string;
    body?: string | null;
    created_at: string;
    closed_at?: string | null;
    merged?: boolean;
    user: {
      id: number;
      login: string;
    };
  };
  repository?: {
    id: number;
    name: string;
    owner: {
      login: string;
    };
  };
  installation?: {
    id: number;
  };
  [key: string]: unknown;
}

export interface WebhookHandlerOptions {
  prismaClient?: typeof prisma;
  webhookSecret?: string;
  onProcessDelivery?: (delivery: {
    deliveryUuid: string;
    event: string;
    action: string | null;
    payload: GitHubWebhookPayload;
  }) => Promise<void>;
  /** Override bot user ID for testing */
  botUserId?: bigint;
}

export const SUPPORTED_EVENTS = new Set([
  "issues",
  "issue_comment",
  "pull_request",
  "installation",
]);

/**
 * Fastify plugin registering:
 *  - POST /webhooks/github  — GitHub App webhook receiver
 *  - POST /internal/sweep   — External scheduler trigger (authenticated by SWEEP_SECRET)
 */
export const webhookRoutes: FastifyPluginAsync<WebhookHandlerOptions> = async (app, opts) => {
  const db = opts.prismaClient ?? prisma;
  const secret = opts.webhookSecret ?? config.GITHUB_WEBHOOK_SECRET ?? "test_webhook_secret_for_patch_wars_2026";
  const botUserId = opts.botUserId ?? config.GITHUB_APP_BOT_USER_ID;

  // ── Helper: build the postReply wrapper for the claim engine ──────────────
  function makePostReply(db: typeof prisma) {
    return async (issueId: string, kind: string, body: string, memberId: string | null) => {
      await postBotComment(issueId, kind, body, memberId, { prismaClient: db });
    };
  }

  // ── POST /webhooks/github ─────────────────────────────────────────────────
  app.post(
    "/github",
    {
      schema: {
        headers: {
          type: "object",
          properties: {
            "x-github-delivery": { type: "string" },
            "x-github-event": { type: "string" },
            "x-hub-signature-256": { type: "string" },
          },
          required: ["x-github-delivery", "x-github-event", "x-hub-signature-256"],
        },
      },
      preValidation: async (request, reply) => {
        const signature = request.headers["x-hub-signature-256"] as string | undefined;
        const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;

        if (!rawBody || !signature) {
          return reply.status(401).send({
            statusCode: 401,
            error: "Unauthorized",
            message: "Missing webhook signature or empty payload",
          });
        }

        const isValid = verifyWebhookSignature(rawBody, signature, secret);
        if (!isValid) {
          return reply.status(401).send({
            statusCode: 401,
            error: "Unauthorized",
            message: "Invalid webhook signature (HMAC mismatch)",
          });
        }
      },
    },
    async (request, reply) => {
      const deliveryUuid = request.headers["x-github-delivery"] as string;
      const event = request.headers["x-github-event"] as string;
      const payload = request.body as GitHubWebhookPayload;
      const action = payload.action ?? null;

      // 1. Idempotency Check & Record WebhookDelivery via transaction
      let deliveryRecord;
      try {
        deliveryRecord = await db.$transaction(async (tx) => {
          return await tx.webhookDelivery.create({
            data: {
              deliveryUuid,
              event,
              action,
              status: "received",
            },
          });
        });
      } catch (err: unknown) {
        const isUniqueConstraint =
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          (err as { code: string }).code === "P2002";

        if (isUniqueConstraint) {
          request.log.info({ deliveryUuid }, "Duplicate X-GitHub-Delivery received. Skipping processing.");
          return reply.status(200).send({
            statusCode: 200,
            ok: true,
            status: "ignored_duplicate",
            message: "Delivery already processed",
          });
        }

        throw err;
      }

      // 2. Fast 200 Response to GitHub
      reply.status(200).send({
        statusCode: 200,
        ok: true,
        deliveryId: deliveryRecord.id,
      });

      // 3. Asynchronous event dispatching
      setImmediate(async () => {
        // Trigger (b): opportunistic sweep at start of every webhook
        runOpportunisticSweep(db, { postReply: makePostReply(db) }).catch(() => {/* non-fatal */});

        try {
          if (opts.onProcessDelivery) {
            await opts.onProcessDelivery({
              deliveryUuid,
              event,
              action,
              payload,
            });
          } else {
            await processWebhookEvent(db, deliveryUuid, event, action, payload, botUserId);
          }

          await db.webhookDelivery.update({
            where: { deliveryUuid },
            data: {
              status: "processed",
              processedAt: new Date(),
            },
          });
        } catch (procErr: unknown) {
          app.log.error({ procErr, deliveryUuid }, "Error during asynchronous webhook processing");
          await db.webhookDelivery.update({
            where: { deliveryUuid },
            data: {
              status: "error",
              error: procErr instanceof Error ? procErr.message : String(procErr),
              processedAt: new Date(),
            },
          });
        }
      });
    }
  );
};

/**
 * Asynchronous dispatcher for supported GitHub events.
 */
export async function processWebhookEvent(
  db: typeof prisma,
  deliveryUuid: string,
  event: string,
  action: string | null,
  payload: GitHubWebhookPayload,
  botUserId?: bigint
): Promise<void> {
  if (!SUPPORTED_EVENTS.has(event)) {
    return;
  }

  if (event === "issue_comment") {
    // Only handle `action: "created"` for claim processing
    // `action: "edited"` is recorded but NEVER creates a claim (9.4)
    if (action === "edited") {
      const comment = payload.comment;
      if (comment) {
        await db.auditLog.create({
          data: {
            actorIp: "github-webhook",
            action: "comment_edit_rejected",
            targetType: "issue_comment",
            targetId: String(comment.id),
            beforeJson: JSON.stringify({ created_at: comment.created_at }),
            afterJson: JSON.stringify({ updated_at: comment.updated_at, body: comment.body }),
          },
        });
      }
      return;
    }

    if (action !== "created") return;

    const comment = payload.comment;
    const ghIssue = payload.issue;
    const repo = payload.repository;

    if (!comment || !ghIssue || !repo) return;

    const intent = parseClaimIntent(comment.body);
    if (intent === null) return; // Not a claim or unclaim comment at all

    const issueCtx = {
      repoOwner: repo.owner.login,
      repoName: repo.name,
      issueNumber: ghIssue.number,
    };

    const nowIso = new Date().toISOString();
    const commentCtx = {
      commentId: BigInt(comment.id),
      githubUserId: BigInt(comment.user.id),
      body: comment.body,
      createdAt: comment.created_at || nowIso,
      updatedAt: comment.updated_at || comment.created_at || nowIso,
    };

    const postReply = async (issueId: string, kind: string, body: string, memberId: string | null) => {
      await postBotComment(issueId, kind, body, memberId, { prismaClient: db });
    };

    if (intent === "claim") {
      await processClaimComment(db, commentCtx, issueCtx, { botUserId, postReply });
    } else if (intent === "unclaim") {
      await processUnclaimComment(db, commentCtx, issueCtx, { botUserId, postReply });
    }
  }

  if (event === "pull_request") {
    const pr = payload.pull_request;
    const repo = payload.repository;

    if (!pr || !repo) return;

    const repoCtx = {
      owner: repo.owner.login,
      name: repo.name,
    };

    const prCtx = {
      id: pr.id,
      number: pr.number,
      title: pr.title || "",
      body: pr.body ?? null,
      createdAt: pr.created_at || new Date().toISOString(),
      closedAt: pr.closed_at ?? null,
      merged: pr.merged ?? false,
      user: {
        id: pr.user.id,
        login: pr.user.login,
      },
    };

    const postReply = async (issueId: string, kind: string, body: string, memberId: string | null) => {
      await postBotComment(issueId, kind, body, memberId, { prismaClient: db });
    };

    if (action === "opened" || action === "reopened" || action === "edited") {
      await processPullRequestOpened(db, prCtx, repoCtx, {
        postReply,
        finalDeadline: config.FINAL_DEADLINE,
      });
    } else if (action === "closed") {
      await processPullRequestClosed(db, prCtx, repoCtx, {
        postReply,
        finalDeadline: config.FINAL_DEADLINE,
      });
    }
  }
}
