/**
 * auth.ts — Phase B5
 *
 * GitHub OAuth login flow per CONTEXT.md §§ 9.3 and 9.8:
 *
 *   GET /auth/github
 *     → redirects to GitHub OAuth with cryptographically random, single-use state
 *     → scope: read:user ONLY (no repo)
 *
 *   GET /auth/github/callback
 *     → verifies state (wrong/absent/reused/expired → 400)
 *     → exchanges code for token
 *     → fetches user from GitHub API (githubUserId and githubLogin come from OAuth response ONLY,
 *        never from client input — CONTEXT.md § 9.3 THE CORE RULE)
 *     → creates/resolves session, sets httpOnly + Secure + SameSite=Lax cookie
 *
 *   POST /auth/logout  (CSRF protected)
 *     → revokes session, clears cookie
 *
 *   GET /auth/me
 *     → returns current authenticated user (from session only)
 */

import { FastifyPluginAsync } from "fastify";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { generateOauthState, consumeOauthState } from "../auth/oauthState.js";
import {
  createSession,
  resolveSession,
  revokeSession,
  hashToken,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
} from "../auth/session.js";
import { readSessionToken } from "../auth/requestHelpers.js";

export interface AuthRoutesOptions {
  prismaClient?: typeof prisma;
  /** Override fetch for testing */
  fetchFn?: typeof globalThis.fetch;
}

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";

/** Cookie options matching CONTEXT.md § 9.8 */
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,      // requires HTTPS; override in test harness
  sameSite: "lax" as const,
  path: "/",
  maxAge: Math.floor(SESSION_TTL_MS / 1000),
  signed: true,
};

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, opts) => {
  const db = opts.prismaClient ?? prisma;
  const fetchFn = opts.fetchFn ?? globalThis.fetch;

  /**
   * GET /auth/github
   * Initiates the GitHub OAuth flow.
   * Generates a cryptographically random, single-use state (10-minute TTL).
   * Redirects to GitHub with scope=read:user ONLY.
   */
  app.get("/github", async (_request, reply) => {
    const state = generateOauthState();

    const clientId = config.GITHUB_CLIENT_ID;
    if (!clientId) {
      return reply.status(503).send({
        statusCode: 503,
        error: "Service Unavailable",
        message: "GitHub OAuth is not configured",
      });
    }

    const params = new URLSearchParams({
      client_id: clientId,
      scope: "read:user",    // MINIMUM scope — never request repo
      state,
    });

    const redirectUrl = `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
    return reply.redirect(redirectUrl, 302);
  });

  /**
   * GET /auth/github/callback
   * Handles the GitHub OAuth callback.
   * Verifies state, exchanges code, fetches user, upserts member, creates session.
   *
   * THE CORE RULE (CONTEXT.md § 9.3):
   * githubUserId and githubLogin come ONLY from the GitHub API response.
   * They are NEVER read from the request body, query params, or any client input.
   */
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/github/callback",
    async (request, reply) => {
      const { code, state, error: oauthError } = request.query;

      // If GitHub returned an error (e.g., user denied)
      if (oauthError) {
        return reply.status(400).send({
          statusCode: 400,
          error: "OAuth Error",
          message: `GitHub OAuth denied: ${oauthError}`,
        });
      }

      // --- State verification (single-use, 10-min TTL, bound to this request) ---
      const stateResult = consumeOauthState(state);
      if (!stateResult.ok) {
        request.log.warn(
          { reason: stateResult.reason, ip: request.ip },
          "OAuth callback: invalid state"
        );
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: `OAuth state invalid: ${stateResult.reason}`,
        });
      }

      if (!code) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: "OAuth code missing from callback",
        });
      }

      const clientId = config.GITHUB_CLIENT_ID;
      const clientSecret = config.GITHUB_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        return reply.status(503).send({
          statusCode: 503,
          error: "Service Unavailable",
          message: "GitHub OAuth is not configured",
        });
      }

      // --- Exchange code for access token ---
      let accessToken: string;
      try {
        const tokenResponse = await fetchFn(GITHUB_TOKEN_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "PatchWars-Tracker-2026",
          },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
          }),
        });

        if (!tokenResponse.ok) {
          const errText = await tokenResponse.text();
          request.log.error({ status: tokenResponse.status, body: errText }, "GitHub token exchange failed");
          return reply.status(502).send({
            statusCode: 502,
            error: "Bad Gateway",
            message: "Failed to exchange OAuth code with GitHub",
          });
        }

        const tokenData = await tokenResponse.json() as {
          access_token?: string;
          error?: string;
          error_description?: string;
        };

        if (!tokenData.access_token) {
          request.log.error({ tokenData }, "GitHub returned no access_token");
          return reply.status(502).send({
            statusCode: 502,
            error: "Bad Gateway",
            message: "GitHub did not return an access token",
          });
        }

        accessToken = tokenData.access_token;
      } catch (err) {
        request.log.error({ err }, "GitHub token exchange error");
        return reply.status(502).send({
          statusCode: 502,
          error: "Bad Gateway",
          message: "GitHub token exchange failed",
        });
      }

      // --- Fetch authenticated user from GitHub API ---
      // THE CORE RULE: identity comes from the OAuth response, never from client input
      let githubUserId: bigint;
      let githubLogin: string;
      let displayName: string;

      try {
        const userResponse = await fetchFn(GITHUB_USER_URL, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "PatchWars-Tracker-2026",
          },
        });

        if (!userResponse.ok) {
          const errText = await userResponse.text();
          request.log.error({ status: userResponse.status, body: errText }, "GitHub user fetch failed");
          return reply.status(502).send({
            statusCode: 502,
            error: "Bad Gateway",
            message: "Failed to fetch user from GitHub",
          });
        }

        const userData = await userResponse.json() as {
          id: number;
          login: string;
          name?: string | null;
        };

        // Numeric githubUserId comes exclusively from GitHub API response
        githubUserId = BigInt(userData.id);
        githubLogin = userData.login;
        displayName = userData.name ?? userData.login;
      } catch (err) {
        request.log.error({ err }, "GitHub user fetch error");
        return reply.status(502).send({
          statusCode: 502,
          error: "Bad Gateway",
          message: "Failed to fetch user from GitHub",
        });
      }

      // --- Upsert member (handles GitHub login renames) ---
      // We match on githubUserId (immutable numeric ID), NOT on githubLogin (renameable)
      // This ensures a GitHub rename does not create a second member
      const existingMember = await db.member.findUnique({
        where: { githubUserId },
      });

      let memberId: string;
      let isNewUser: boolean;

      if (existingMember) {
        // Update githubLogin if it changed (handles renames without breaking claim matching)
        await db.member.update({
          where: { githubUserId },
          data: { githubLogin, displayName },
        });
        memberId = existingMember.id;
        isNewUser = false;
      } else {
        // New user — needs to complete registration
        const newMember = await db.member.create({
          data: {
            githubUserId,
            githubLogin,
            displayName,
            // Temporary defaults; registration/complete will set these
            department: "pr" as any,
            team: "NEXUS" as any,
            tier: "general" as any,
          },
        });
        memberId = newMember.id;
        isNewUser = true;
      }

      // --- Create session ---
      const rawToken = await createSession(
        db,
        memberId,
        request.ip,
        request.headers["user-agent"]
      );

      // Set signed httpOnly cookie per CONTEXT.md § 9.8
      reply.setCookie(SESSION_COOKIE_NAME, rawToken, COOKIE_OPTIONS);

      // Redirect: new users go to registration, returning users go to dashboard.
      // Use RENDER_EXTERNAL_URL (auto-set by Render) so the redirect always lands
      // on the live site, never on localhost — even if CORS_ORIGIN still lists localhost.
      const frontendBase =
        process.env["RENDER_EXTERNAL_URL"]?.replace(/\/$/, "") ??
        config.CORS_ORIGIN[0] ??
        "http://localhost:3000";
      const redirectPath = isNewUser ? "/register" : "/dashboard";
      return reply.redirect(`${frontendBase}${redirectPath}`, 302);
    }
  );

  /**
   * GET /auth/csrf
   * Returns a fresh CSRF token and sets the _csrf cookie.
   */
  app.get("/csrf", async (_request, reply) => {
    const token = reply.generateCsrf();
    return reply.status(200).send({
      statusCode: 200,
      csrfToken: token,
    });
  });

  /**
   * GET /auth/me
   * Returns the current authenticated user from the session cookie.
   * Never exposes session token or sensitive data.
   */
  app.get("/me", async (request, reply) => {
    const rawToken = readSessionToken(request);
    const session = await resolveSession(db, rawToken);

    if (!session) {
      return reply.status(401).send({
        statusCode: 401,
        error: "Unauthorized",
        message: "Not authenticated",
      });
    }

    return reply.status(200).send({
      statusCode: 200,
      user: {
        memberId: session.memberId,
        githubLogin: session.member.githubLogin,
        displayName: session.member.displayName,
        department: session.member.department,
        team: session.member.team,
        tier: session.member.tier,
        // isAdmin is derived from the allowlist; we expose it as a boolean for UI convenience
        // but ALL admin route access is re-checked server-side — this field is purely informational
        isAdmin: config.ADMIN_GITHUB_USER_IDS.includes(session.member.githubUserId),
      },
    });
  });

  /**
   * POST /auth/logout
   * Revokes the current session and clears the cookie.
   * CSRF protected (requires X-CSRF-Token header).
   */
  app.post(
    "/logout",
    { preHandler: app.csrfProtection },
    async (request, reply) => {
      const rawToken = readSessionToken(request);

      if (rawToken) {
        const tokenHash = hashToken(rawToken);
        await revokeSession(db, tokenHash);
      }

      reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });

      return reply.status(200).send({
        statusCode: 200,
        message: "Logged out successfully",
      });
    }
  );
};
