import fastify, { FastifyInstance } from "fastify";
import fastifyHelmet from "@fastify/helmet";
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import fastifyCsrf from "@fastify/csrf-protection";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { webhookRoutes, WebhookHandlerOptions } from "./webhooks/handler.js";
import { leaderboardRoutes } from "./routes/leaderboard.js";
import { issuesRoutes } from "./routes/issues.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { authRoutes } from "./routes/auth.js";
import { registrationRoutes } from "./routes/registration.js";
import { adminRoutes } from "./routes/admin.js";
import { runOpportunisticSweep, runExpirySweep } from "./domain/expirySweep.js";
import { postBotComment } from "./github/comments.js";

export interface BuildAppOptions extends WebhookHandlerOptions {
  disableLogging?: boolean;
  fetchFn?: typeof globalThis.fetch;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const db = options.prismaClient ?? prisma;

  const app = fastify({
    logger: options.disableLogging
      ? false
      : {
          level: config.NODE_ENV === "test" ? "silent" : "info",
          serializers: {
            req(req) {
              const isAuthRoute = req.url.startsWith("/auth") || req.url.includes("login") || req.url.includes("token");
              return {
                method: req.method,
                url: req.url,
                requestId: req.id,
                headers: {
                  host: req.headers.host,
                  "user-agent": req.headers["user-agent"],
                },
                // Never log request bodies or sensitive headers of auth routes
                body: isAuthRoute ? "[REDACTED]" : req.body,
              };
            },
            res(res) {
              return {
                statusCode: res.statusCode,
              };
            },
          },
        },
    requestIdHeader: "x-request-id",
  });

  // 1. Security Headers via Helmet with strict CSP
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https://avatars.githubusercontent.com"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'none'"],
        frameSrc: ["'none'"],
        upgradeInsecureRequests: config.NODE_ENV === "production" ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  // 2. CORS with strict origin allowlist
  await app.register(fastifyCors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (like mobile apps, curl, same-origin)
      if (!origin) {
        cb(null, true);
        return;
      }
      if (config.CORS_ORIGIN.includes(origin)) {
        cb(null, true);
        return;
      }
      cb(new Error("CORS origin not allowed"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  // 3. Rate limiting (Global + tighter for write routes)
  await app.register(fastifyRateLimit, {
    global: true,
    max: 120,
    timeWindow: "1 minute",
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
    }),
  });

  // 3b. Cookie support (signed cookies for session tokens per CONTEXT.md § 9.8)
  // Must be registered BEFORE CSRF and BEFORE auth routes
  await app.register(fastifyCookie, {
    secret: config.SESSION_SECRET,  // used to sign/unsign cookies
    hook: "onRequest",
    parseOptions: {},
  });

  // 3c. CSRF protection on cookie-authenticated mutations per CONTEXT.md § 9.8
  // Protects POST/PATCH/PUT/DELETE endpoints that use session cookies
  await app.register(fastifyCsrf, {
    sessionPlugin: "@fastify/cookie",
    cookieOpts: { signed: true },
  });

  // 4. Central Error Handler (Generic client messages, detailed server logs, no stack trace in response)
  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    const statusCode =
      typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : 500;

    // Log full error detail server-side
    request.log.error(
      {
        err: error,
        requestId: request.id,
        url: request.url,
        method: request.method,
      },
      "Server Error"
    );

    // Client response: never expose stack traces or raw internal errors
    if (statusCode === 500) {
      reply.status(500).send({
        statusCode: 500,
        error: "Internal Server Error",
        message: "An unexpected error occurred. Please try again later.",
      });
    } else {
      reply.status(statusCode).send({
        statusCode,
        error: error.name || "Request Error",
        message: error.message || "An error occurred processing the request.",
      });
    }
  });

  // Preserve raw request body bytes for HMAC signature verification
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (req, body: Buffer, done) => {
      (req as unknown as { rawBody: Buffer }).rawBody = body;
      if (!body || body.length === 0) {
        done(null, {});
        return;
      }
      try {
        const json = JSON.parse(body.toString("utf-8"));
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  // 5. Webhook Ingestion Routes (/webhooks/github)
  await app.register(webhookRoutes, {
    prefix: "/webhooks",
    prismaClient: db,
    webhookSecret: options.webhookSecret,
    onProcessDelivery: options.onProcessDelivery,
  });

  // 6. Public Leaderboard and Scoring Routes (/api)
  await app.register(leaderboardRoutes, {
    prefix: "/api",
    prismaClient: db,
  });

  // 6b. Public Issues Board Route (/api/issues)
  await app.register(issuesRoutes, {
    prefix: "/api",
    prismaClient: db,
  });

  // 6c. Member Dashboard Route (/api/dashboard)
  await app.register(dashboardRoutes, {
    prefix: "/api",
    prismaClient: db,
  });

  // 7b. Auth Routes (GitHub OAuth, session management)
  await app.register(authRoutes, {
    prefix: "/auth",
    prismaClient: db,
    fetchFn: options.fetchFn,
  });

  // 7c. Registration Routes (/api/registration)
  await app.register(registrationRoutes, {
    prefix: "/api",
    prismaClient: db,
  });

  // 7d. Admin Routes (/api/admin) — all guarded by allowlist check
  await app.register(adminRoutes, {
    prefix: "/api/admin",
    prismaClient: db,
  });

  // 7e. Opportunistic Sweep Hook on API / Webhook / Auth requests
  app.addHook("onRequest", async (request) => {
    const url = request.url;
    if (url.startsWith("/api") || url.startsWith("/webhooks") || url.startsWith("/auth")) {
      runOpportunisticSweep(db, {
        postReply: async (issueId, kind, body, memberId) => {
          await postBotComment(issueId, kind, body, memberId, { prismaClient: db });
        },
      })
        .then((swept) => {
          if (swept) {
            request.log.info("Opportunistic expiry sweep executed successfully.");
          }
        })
        .catch(() => {/* non-fatal background execution */});
    }
  });

  // 7f. POST /internal/sweep — External scheduler trigger (authenticated by SWEEP_SECRET)
  app.post("/internal/sweep", async (request, reply) => {
    const authHeader = request.headers.authorization;
    const sweepSecret = config.SWEEP_SECRET;

    if (!sweepSecret) {
      return reply.status(503).send({
        statusCode: 503,
        error: "Not Configured",
        message: "SWEEP_SECRET is not configured on this server.",
      });
    }

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return reply.status(401).send({
        statusCode: 401,
        error: "Unauthorized",
        message: "Missing or malformed Authorization header. Use: Authorization: Bearer <SWEEP_SECRET>",
      });
    }

    const token = authHeader.slice("Bearer ".length);
    const crypto = await import("node:crypto");
    const expected = Buffer.from(sweepSecret, "utf-8");
    const provided = Buffer.from(token, "utf-8");
    const isValid =
      expected.length === provided.length &&
      crypto.timingSafeEqual(expected, provided);

    if (!isValid) {
      return reply.status(401).send({
        statusCode: 401,
        error: "Unauthorized",
        message: "Invalid sweep secret.",
      });
    }

    const result = await runExpirySweep(db, {
      postReply: async (issueId, kind, body, memberId) => {
        await postBotComment(issueId, kind, body, memberId, { prismaClient: db });
      },
    });

    return reply.status(200).send({
      statusCode: 200,
      ok: true,
      expired: result.expired,
      promoted: result.promoted,
    });
  });

  // 7. Health Check Route (Fast, lightweight DB round-trip via SELECT 1, no auth)
  app.get("/health", async (_request, reply) => {
    try {
      await db.$queryRaw`SELECT 1`;
      return reply.status(200).send({
        status: "ok",
        db: "connected",
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      app.log.error({ err }, "Database health check failed");
      return reply.status(503).send({
        status: "error",
        db: "disconnected",
        message: "Database unreachable",
      });
    }
  });

  // 6. Same-origin Static Asset Serving and Client-Side Routing Fallthrough
  const webDistPath = path.resolve(process.cwd(), "web/dist");
  const indexHtmlPath = path.join(webDistPath, "index.html");

  // Ensure index.html exists in web/dist
  if (!fs.existsSync(webDistPath)) {
    fs.mkdirSync(webDistPath, { recursive: true });
  }
  if (!fs.existsSync(indexHtmlPath)) {
    fs.writeFileSync(
      indexHtmlPath,
      "<!DOCTYPE html><html><head><title>Patch Wars 2026</title></head><body><div id=\"root\">Patch Wars 2026 Tracker</div></body></html>",
      "utf-8"
    );
  }

  await app.register(fastifyStatic, {
    root: webDistPath,
    prefix: "/",
    wildcard: false,
  });

  // Fallthrough handler for non-API SPA client-side routes
  app.setNotFoundHandler((request, reply) => {
    const isApiRoute =
      request.url.startsWith("/api") ||
      request.url.startsWith("/auth") ||
      request.url.startsWith("/webhooks");

    if (isApiRoute) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: `Endpoint ${request.method} ${request.url} not found`,
      });
    }

    // Serve index.html for client-side routing
    return reply.sendFile("index.html");
  });

  return app;
}
