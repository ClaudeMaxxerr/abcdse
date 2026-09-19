/**
 * b5_auth.test.ts — Phase B5
 *
 * Tests for GitHub OAuth login, registration, sessions, CSRF, admin allowlist.
 *
 * All tests use in-memory mock DB and mock fetch — no network or real DB required.
 * Tests are purely unit/integration against the route handlers and domain logic.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  generateOauthState,
  consumeOauthState,
  _testInjectState,
  _testClearStates,
} from "../src/auth/oauthState.js";
import {
  createSession,
  resolveSession,
  revokeSession,
  hashToken,
  SESSION_COOKIE_NAME,
} from "../src/auth/session.js";
import { deriveTier, detectForbiddenFields } from "../src/routes/registration.js";
import { Department, Team, Tier } from "@prisma/client";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";

// ─────────────────────────────────────────────────────────────────────────────
// Minimal mock DB
// ─────────────────────────────────────────────────────────────────────────────

function makeMockDb() {
  const sessions = new Map<string, any>();
  const members = new Map<string, any>();
  const systemConfigs = new Map<string, any>();
  const auditLogs: any[] = [];

  // Helper: find a member by any unique field
  function findMember(where: any): any {
    if (where.id) return members.get(where.id) ?? null;
    if (where.githubUserId !== undefined) {
      for (const m of members.values()) {
        if (m.githubUserId === where.githubUserId) return m;
      }
    }
    return null;
  }

  return {
    _sessions: sessions,
    _members: members,
    _systemConfigs: systemConfigs,
    _auditLogs: auditLogs,

    session: {
      create: vi.fn(async ({ data }: { data: any }) => {
        const id = `session-${Math.random()}`;
        const row = { id, revokedAt: null, ...data };
        sessions.set(data.tokenHash, row);
        return row;
      }),
      findUnique: vi.fn(async ({ where, include }: { where: any; include?: any }) => {
        const row = sessions.get(where.tokenHash) ?? null;
        if (!row) return null;
        if (include?.member) {
          const member = members.get(row.memberId) ?? null;
          return { ...row, member };
        }
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: any; data: any }) => {
        let count = 0;
        for (const [key, row] of sessions.entries()) {
          if (where.tokenHash && row.tokenHash !== where.tokenHash) continue;
          if (where.revokedAt === null && row.revokedAt !== null) continue;
          Object.assign(row, data);
          sessions.set(key, row);
          count++;
        }
        return { count };
      }),
    },

    member: {
      create: vi.fn(async ({ data }: { data: any }) => {
        const id = `member-${Math.random()}`;
        const row = { id, isAdmin: false, ...data };
        members.set(id, row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: { where: any }) => {
        return findMember(where);
      }),
      update: vi.fn(async ({ where, data }: { where: any; data: any }) => {
        const row = findMember(where);
        if (!row) throw new Error("Member not found");
        Object.assign(row, data);
        return row;
      }),
      findMany: vi.fn(async ({ select }: { select?: any }) => {
        return Array.from(members.values()).map((m) => {
          if (!select) return m;
          const out: any = {};
          for (const k of Object.keys(select)) {
            out[k] = m[k];
          }
          return out;
        });
      }),
    },

    systemConfig: {
      findUnique: vi.fn(async ({ where }: { where: any }) => {
        return systemConfigs.get(where.key) ?? null;
      }),
      upsert: vi.fn(async ({ where, update, create }: { where: any; update: any; create: any }) => {
        const existing = systemConfigs.get(where.key);
        const row = existing ? { ...existing, ...update } : create;
        systemConfigs.set(where.key, row);
        return row;
      }),
    },

    auditLog: {
      create: vi.fn(async ({ data }: { data: any }) => {
        const row = { id: `audit-${Math.random()}`, ...data };
        auditLogs.push(row);
        return row;
      }),
      findMany: vi.fn(async () => auditLogs),
    },

    $queryRaw: vi.fn(async () => [{ "?column?": 1 }]),
    $disconnect: vi.fn(async () => {}),
  } as any;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers to build a test Fastify app with mock DB
// ─────────────────────────────────────────────────────────────────────────────

const TEST_ADMIN_USER_ID = 174175300n;

// Override env for tests
vi.stubEnv("NODE_ENV", "test");
vi.stubEnv("ADMIN_GITHUB_USER_IDS", "174175300");
vi.stubEnv("SESSION_SECRET", "test_session_secret_min32chars_padded_1234");
vi.stubEnv("CORS_ORIGIN", "http://localhost:3000");
vi.stubEnv("GITHUB_CLIENT_ID", "test_client_id");
vi.stubEnv("GITHUB_CLIENT_SECRET", "test_client_secret");
vi.stubEnv("DATABASE_URL", "postgresql://test@localhost:5432/test?pgbouncer=true");
vi.stubEnv("DIRECT_URL", "postgresql://test@localhost:5432/test");

// Re-import config after env stub (done at module level in config.ts)
// We use dynamic import in beforeEach if needed, but for pure unit tests
// we import the functions directly.

async function makeTestApp(db: any, mockFetch?: typeof globalThis.fetch) {
  const app = await buildApp({
    disableLogging: true,
    prismaClient: db,
    webhookSecret: "test-secret",
    fetchFn: mockFetch,
  } as any);
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. OAuth State Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("OAuth state — generation and consumption", () => {
  beforeEach(() => {
    _testClearStates();
  });

  it("generates a hex state string of 64 chars (32 bytes)", () => {
    const state = generateOauthState();
    expect(typeof state).toBe("string");
    expect(state).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(state)).toBe(true);
  });

  it("consumes a valid state successfully", () => {
    const state = generateOauthState();
    const result = consumeOauthState(state);
    expect(result.ok).toBe(true);
  });

  it("rejects absent state (undefined)", () => {
    const result = consumeOauthState(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("absent");
  });

  it("rejects absent state (wrong/unknown string)", () => {
    const result = consumeOauthState("completely_wrong_state_value");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("absent");
  });

  it("rejects reused state (single-use enforcement)", () => {
    const state = generateOauthState();
    const first = consumeOauthState(state);
    expect(first.ok).toBe(true);
    const second = consumeOauthState(state);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("reused");
  });

  it("rejects expired state (TTL > 10 minutes)", () => {
    const state = "expiredstate123abc";
    // Inject an entry created 11 minutes ago
    _testInjectState(state, {
      createdAt: Date.now() - 11 * 60 * 1000,
      used: false,
    });
    const result = consumeOauthState(state);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Session Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Session management", () => {
  it("createSession returns a raw token and stores only hash in DB", async () => {
    const db = makeMockDb();
    const memberId = "member-abc";
    db._members.set(memberId, {
      id: memberId,
      githubUserId: 12345n,
      githubLogin: "user",
      displayName: "User",
      department: "pr",
      team: "NEXUS",
      tier: "general",
      isAdmin: false,
    });

    const rawToken = await createSession(db, memberId, "127.0.0.1", "test-ua");
    expect(typeof rawToken).toBe("string");
    expect(rawToken).toHaveLength(64); // 32 bytes hex

    // Verify only hash stored
    const storedHash = hashToken(rawToken);
    expect(db.session.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tokenHash: storedHash }),
      })
    );
    // Raw token NOT in DB
    expect(db.session.create.mock.calls[0][0].data.tokenHash).not.toBe(rawToken);
  });

  it("resolveSession returns session for valid token", async () => {
    const db = makeMockDb();
    const memberId = "member-abc";
    db._members.set(memberId, {
      id: memberId,
      githubUserId: 12345n,
      githubLogin: "user",
      displayName: "User",
      department: "pr",
      team: "NEXUS",
      tier: "general",
      isAdmin: false,
    });

    const rawToken = await createSession(db, memberId, "127.0.0.1", "ua");
    const session = await resolveSession(db, rawToken);
    expect(session).not.toBeNull();
    expect(session?.memberId).toBe(memberId);
  });

  it("resolveSession returns null for unknown token", async () => {
    const db = makeMockDb();
    const result = await resolveSession(db, "unknowntoken");
    expect(result).toBeNull();
  });

  it("resolveSession returns null for expired session", async () => {
    const db = makeMockDb();
    const memberId = "member-abc";
    db._members.set(memberId, {
      id: memberId,
      githubUserId: 12345n,
      githubLogin: "user",
      displayName: "User",
      department: "pr",
      team: "NEXUS",
      tier: "general",
      isAdmin: false,
    });

    const rawToken = await createSession(db, memberId, "127.0.0.1", "ua");
    // Manually expire the session
    const storedHash = hashToken(rawToken);
    const row = db._sessions.get(storedHash);
    row.expiresAt = new Date(Date.now() - 1000); // expired 1 second ago

    const session = await resolveSession(db, rawToken);
    expect(session).toBeNull();
  });

  it("revokeSession causes resolveSession to return null immediately", async () => {
    const db = makeMockDb();
    const memberId = "member-abc";
    db._members.set(memberId, {
      id: memberId,
      githubUserId: 12345n,
      githubLogin: "user",
      displayName: "User",
      department: "pr",
      team: "NEXUS",
      tier: "general",
      isAdmin: false,
    });

    const rawToken = await createSession(db, memberId, "127.0.0.1", "ua");

    // Verify it resolves before revocation
    const before = await resolveSession(db, rawToken);
    expect(before).not.toBeNull();

    // Revoke
    await revokeSession(db, hashToken(rawToken));

    // Must return null immediately after revocation
    const after = await resolveSession(db, rawToken);
    expect(after).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Registration — tier derivation and mass-assignment defence
// ─────────────────────────────────────────────────────────────────────────────

describe("Registration — tier derivation", () => {
  const cases: Array<[Department, Tier]> = [
    [Department.technical, Tier.tech],
    [Department.pr, Tier.general],
    [Department.social, Tier.general],
    [Department.design, Tier.general],
    [Department.event_management, Tier.general],
    [Department.research_and_development, Tier.general],
  ];

  for (const [dept, expectedTier] of cases) {
    it(`department '${dept}' → tier '${expectedTier}'`, () => {
      expect(deriveTier(dept)).toBe(expectedTier);
    });
  }
});

describe("Registration — mass-assignment defence", () => {
  it("detects 'tier' in request body", () => {
    const forbidden = detectForbiddenFields({ department: "pr", team: "NEXUS", tier: "tech" });
    expect(forbidden).toContain("tier");
  });

  it("detects 'isAdmin' in request body", () => {
    const forbidden = detectForbiddenFields({ department: "pr", isAdmin: true });
    expect(forbidden).toContain("isAdmin");
  });

  it("detects 'githubUserId' in request body", () => {
    const forbidden = detectForbiddenFields({ githubUserId: 123 });
    expect(forbidden).toContain("githubUserId");
  });

  it("detects 'githubLogin' in request body", () => {
    const forbidden = detectForbiddenFields({ githubLogin: "hacker" });
    expect(forbidden).toContain("githubLogin");
  });

  it("returns empty array for clean body", () => {
    const forbidden = detectForbiddenFields({ department: "pr", team: "NEXUS" });
    expect(forbidden).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. HTTP route integration tests via Fastify injection
// ─────────────────────────────────────────────────────────────────────────────

describe("Auth routes — GET /auth/github", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof makeMockDb>;

  beforeEach(async () => {
    _testClearStates();
    db = makeMockDb();
    app = await makeTestApp(db);
  });

  afterEach(async () => {
    await app.close();
  });

  it("redirects to GitHub with state and scope=read:user", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/github" });
    expect(res.statusCode).toBe(302);
    const location = res.headers["location"] as string;
    expect(location).toContain("github.com/login/oauth/authorize");
    expect(location).toContain("scope=read%3Auser");
    expect(location).toContain("state=");
    // Must NOT request repo scope
    expect(location).not.toContain("repo");
  });
});

describe("Auth routes — GET /auth/github/callback", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof makeMockDb>;

  function makeMockFetch(githubUserId = 999, githubLogin = "testuser") {
    return vi.fn().mockImplementation(async (url: string) => {
      if (url === "https://github.com/login/oauth/access_token") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "mock_access_token" }),
        };
      }
      if (url === "https://api.github.com/user") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: githubUserId, login: githubLogin, name: "Test User" }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
  }

  beforeEach(async () => {
    _testClearStates();
    db = makeMockDb();
    app = await makeTestApp(db, makeMockFetch());
  });

  afterEach(async () => {
    await app.close();
  });

  it("rejects absent state with 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/auth/github/callback?code=somecode",
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.message).toContain("absent");
  });

  it("rejects wrong (unknown) state with 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/auth/github/callback?code=somecode&state=wrongstatevalue12345",
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.message).toContain("absent");
  });

  it("rejects reused state with 400", async () => {
    const state = generateOauthState();
    // First use
    await app.inject({
      method: "GET",
      url: `/auth/github/callback?code=code1&state=${state}`,
    });
    // Second use — must be rejected
    const res = await app.inject({
      method: "GET",
      url: `/auth/github/callback?code=code2&state=${state}`,
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.message).toContain("reused");
  });

  it("rejects expired state with 400", async () => {
    const state = "expiredcallbackstate123abc456def";
    _testInjectState(state, { createdAt: Date.now() - 11 * 60 * 1000, used: false });

    const res = await app.inject({
      method: "GET",
      url: `/auth/github/callback?code=somecode&state=${state}`,
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.message).toContain("expired");
  });

  it("creates session and sets cookie with httpOnly, Secure, SameSite on success", async () => {
    const state = generateOauthState();
    const res = await app.inject({
      method: "GET",
      url: `/auth/github/callback?code=validcode&state=${state}`,
    });

    // Should redirect (new user) or 302
    expect([200, 302]).toContain(res.statusCode);

    const setCookie = res.headers["set-cookie"] as string | string[];
    const cookieStr = Array.isArray(setCookie) ? setCookie.find((c) => c.includes("pw_sid")) : setCookie;
    expect(cookieStr).toBeTruthy();
    expect(cookieStr).toMatch(/HttpOnly/i);
    expect(cookieStr).toMatch(/Secure/i);
    expect(cookieStr).toMatch(/SameSite=Lax/i);
  });

  it("registers new user on first login (creates member)", async () => {
    const state = generateOauthState();
    await app.inject({
      method: "GET",
      url: `/auth/github/callback?code=validcode&state=${state}`,
    });
    expect(db.member.create).toHaveBeenCalled();
  });

  it("registering twice with same githubUserId updates rather than duplicating", async () => {
    // First login
    const state1 = generateOauthState();
    await app.inject({
      method: "GET",
      url: `/auth/github/callback?code=code1&state=${state1}`,
    });

    const createCallsBefore = db.member.create.mock.calls.length;

    // Second login (same user)
    const state2 = generateOauthState();
    await app.inject({
      method: "GET",
      url: `/auth/github/callback?code=code2&state=${state2}`,
    });

    // create should not have been called again
    const createCallsAfter = db.member.create.mock.calls.length;
    expect(createCallsAfter).toBe(createCallsBefore); // no new create

    // update should have been called (to refresh githubLogin / displayName)
    expect(db.member.update).toHaveBeenCalled();
  });

  it("GitHub login rename updates githubLogin without creating new member", async () => {
    // Insert the existing member directly
    const existingMemberId = "member-existing";
    db._members.set(existingMemberId, {
      id: existingMemberId,
      githubUserId: 999n, // Same numeric ID as mock returns
      githubLogin: "oldlogin",
      displayName: "Old Name",
      department: "pr",
      team: "NEXUS",
      tier: "general",
      isAdmin: false,
    });

    // Mock findUnique to return by githubUserId
    db.member.findUnique.mockImplementation(async ({ where }: { where: any }) => {
      if (where.id) return db._members.get(where.id) ?? null;
      if (where.githubUserId !== undefined) {
        for (const m of db._members.values()) {
          if (m.githubUserId === where.githubUserId) return m;
        }
      }
      return null;
    });

    const memberCountBefore = db._members.size;

    // OAuth callback: GitHub returns id=999, login="newlogin" (renamed)
    const fetchWithRename = vi.fn().mockImplementation(async (url: string) => {
      if (url === "https://github.com/login/oauth/access_token") {
        return { ok: true, json: async () => ({ access_token: "tok" }) };
      }
      if (url === "https://api.github.com/user") {
        return { ok: true, json: async () => ({ id: 999, login: "newlogin", name: "New Name" }) };
      }
      throw new Error(`Unexpected: ${url}`);
    });

    await app.close();
    app = await makeTestApp(db, fetchWithRename);

    const state = generateOauthState();
    await app.inject({
      method: "GET",
      url: `/auth/github/callback?code=someCode&state=${state}`,
    });

    // No new member created
    expect(db._members.size).toBe(memberCountBefore);

    // Login updated
    expect(db.member.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ githubLogin: "newlogin" }),
      })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Registration route — mass-assignment and enum validation
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/registration/complete — validation", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof makeMockDb>;
  let sessionCookie: string;
  let csrfToken: string;
  let memberId: string;

  beforeEach(async () => {
    _testClearStates();
    db = makeMockDb();

    // Create a member + session we can use
    memberId = "member-test";
    db._members.set(memberId, {
      id: memberId,
      githubUserId: 42n,
      githubLogin: "tester",
      displayName: "Tester",
      department: "pr",
      team: "NEXUS",
      tier: "general",
      isAdmin: false,
    });

    app = await makeTestApp(db);

    // Create session and get cookie
    const rawToken = await createSession(db, memberId, "127.0.0.1", "test");
    const signedSid = app.signCookie(rawToken);

    // Get CSRF token and cookie
    const csrfRes = await app.inject({ method: "GET", url: "/auth/csrf" });
    const csrfData = JSON.parse(csrfRes.body);
    csrfToken = csrfData.csrfToken;
    const csrfCookieHeader = csrfRes.headers["set-cookie"];
    const csrfCookie = Array.isArray(csrfCookieHeader) ? csrfCookieHeader.join("; ") : (csrfCookieHeader || "");

    sessionCookie = `${SESSION_COOKIE_NAME}=${signedSid}; ${csrfCookie}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it("rejects body containing 'tier'", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/registration/complete",
      headers: {
        cookie: sessionCookie,
        "x-csrf-token": csrfToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        department: "pr",
        team: "NEXUS",
        tier: "tech",
      }),
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.message).toContain("tier");
  });

  it("rejects body containing 'isAdmin'", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/registration/complete",
      headers: {
        cookie: sessionCookie,
        "x-csrf-token": csrfToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        department: "pr",
        team: "NEXUS",
        isAdmin: true,
      }),
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.message).toContain("isAdmin");
  });

  it("rejects body containing 'githubUserId'", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/registration/complete",
      headers: {
        cookie: sessionCookie,
        "x-csrf-token": csrfToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        department: "pr",
        team: "NEXUS",
        githubUserId: 12345,
      }),
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.message).toContain("githubUserId");
  });

  it("rejects body containing 'githubLogin'", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/registration/complete",
      headers: {
        cookie: sessionCookie,
        "x-csrf-token": csrfToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        department: "pr",
        team: "NEXUS",
        githubLogin: "hacker",
      }),
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.message).toContain("githubLogin");
  });

  it("rejects lowercase team value 'nexus'", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/registration/complete",
      headers: {
        cookie: sessionCookie,
        "x-csrf-token": csrfToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        department: "pr",
        team: "nexus",  // lowercase — not in enum
      }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects free-text team value 'Byte Brigade'", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/registration/complete",
      headers: {
        cookie: sessionCookie,
        "x-csrf-token": csrfToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        department: "pr",
        team: "Byte Brigade",  // display name — not in enum
      }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts valid body and derives tier correctly (technical → tech)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/registration/complete",
      headers: {
        cookie: sessionCookie,
        "x-csrf-token": csrfToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        department: "technical",
        team: "NEXUS",
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.member.tier).toBe("tech");
    // Should NOT have accepted tier from client
    expect(db.member.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tier: "tech" }),
      })
    );
  });

  it("accepts valid body and derives tier correctly (pr → general)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/registration/complete",
      headers: {
        cookie: sessionCookie,
        "x-csrf-token": csrfToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        department: "pr",
        team: "CIPHER",
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.member.tier).toBe("general");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Admin routes — 403 for non-allowlisted users
// ─────────────────────────────────────────────────────────────────────────────

describe("Admin routes — non-allowlisted user gets 403 on every route", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof makeMockDb>;

  // The ADMIN_GITHUB_USER_IDS env is set to 174175300 in stubEnv above
  // We'll test with a different user ID that is NOT in the allowlist
  const NON_ADMIN_USER_ID = 99999999n;
  const NON_ADMIN_MEMBER_ID = "non-admin-member";

  beforeEach(async () => {
    _testClearStates();
    db = makeMockDb();

    db._members.set(NON_ADMIN_MEMBER_ID, {
      id: NON_ADMIN_MEMBER_ID,
      githubUserId: NON_ADMIN_USER_ID,
      githubLogin: "notadmin",
      displayName: "Not Admin",
      department: "pr",
      team: "NEXUS",
      tier: "general",
      isAdmin: false,
    });

    app = await makeTestApp(db);
  });

  afterEach(async () => {
    await app.close();
  });

  async function nonAdminCookie(): Promise<string> {
    const rawToken = await createSession(db, NON_ADMIN_MEMBER_ID, "127.0.0.1", "test");
    return `${SESSION_COOKIE_NAME}=${app.signCookie(rawToken)}`;
  }

  // All admin routes to test — enumerate every route
  const adminRoutes = [
    { method: "GET" as const, url: "/api/admin/members" },
    { method: "GET" as const, url: "/api/admin/audit-log" },
    { method: "PATCH" as const, url: "/api/admin/registration/lock" },
    { method: "POST" as const, url: "/api/admin/sessions/revoke" },
  ];

  for (const route of adminRoutes) {
    it(`${route.method} ${route.url} → 403 for non-admin`, async () => {
      const cookie = await nonAdminCookie();
      const res = await app.inject({
        method: route.method,
        url: route.url,
        headers: { cookie },
        body: route.method !== "GET" ? JSON.stringify({}) : undefined,
      });
      expect(res.statusCode).toBe(403);
    });
  }

  it("returns 401 for unauthenticated request to admin route", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/members",
    });
    expect(res.statusCode).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Session revocation — revoked session rejected immediately
// ─────────────────────────────────────────────────────────────────────────────

describe("Session revocation", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof makeMockDb>;
  const memberId = "member-revoke-test";

  beforeEach(async () => {
    _testClearStates();
    db = makeMockDb();
    db._members.set(memberId, {
      id: memberId,
      githubUserId: 12345n,
      githubLogin: "revoketest",
      displayName: "Revoke Test",
      department: "pr",
      team: "NEXUS",
      tier: "general",
      isAdmin: false,
    });
    app = await makeTestApp(db);
  });

  afterEach(async () => {
    await app.close();
  });

  it("revoked session gets 401 on /auth/me immediately", async () => {
    const rawToken = await createSession(db, memberId, "127.0.0.1", "ua");
    const cookie = `${SESSION_COOKIE_NAME}=${app.signCookie(rawToken)}`;

    // First call — should work
    const before = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie },
    });
    expect(before.statusCode).toBe(200);

    // Revoke the session
    await revokeSession(db, hashToken(rawToken));

    // Immediately after revocation — must be 401
    const after = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie },
    });
    expect(after.statusCode).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. CSRF protection on mutations
// ─────────────────────────────────────────────────────────────────────────────

describe("CSRF protection", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof makeMockDb>;
  const memberId = "member-csrf-test";

  beforeEach(async () => {
    _testClearStates();
    db = makeMockDb();
    db._members.set(memberId, {
      id: memberId,
      githubUserId: 12345n,
      githubLogin: "csrftest",
      displayName: "CSRF Test",
      department: "pr",
      team: "NEXUS",
      tier: "general",
      isAdmin: false,
    });
    app = await makeTestApp(db);
  });

  afterEach(async () => {
    await app.close();
  });

  it("POST /auth/logout without CSRF token is rejected (403 or 400)", async () => {
    const rawToken = await createSession(db, memberId, "127.0.0.1", "ua");
    const cookie = `${SESSION_COOKIE_NAME}=${app.signCookie(rawToken)}`;

    const res = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie },
      // No X-CSRF-Token header
    });
    // CSRF plugin returns 403
    expect([400, 403]).toContain(res.statusCode);
  });

  it("POST /api/registration/complete without CSRF token is rejected", async () => {
    const rawToken = await createSession(db, memberId, "127.0.0.1", "ua");
    const cookie = `${SESSION_COOKIE_NAME}=${app.signCookie(rawToken)}`;

    const res = await app.inject({
      method: "POST",
      url: "/api/registration/complete",
      headers: {
        cookie,
        "content-type": "application/json",
        // No X-CSRF-Token
      },
      body: JSON.stringify({ department: "pr", team: "NEXUS" }),
    });
    expect([400, 403]).toContain(res.statusCode);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Cookie flags
// ─────────────────────────────────────────────────────────────────────────────

describe("Session cookie flags", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof makeMockDb>;

  beforeEach(async () => {
    _testClearStates();
    db = makeMockDb();
    app = await makeTestApp(db, async (url: string) => {
      if (url === "https://github.com/login/oauth/access_token") {
        return { ok: true, json: async () => ({ access_token: "tok" }) } as any;
      }
      if (url === "https://api.github.com/user") {
        return { ok: true, json: async () => ({ id: 777, login: "cookietest", name: "Cookie Test" }) } as any;
      }
      throw new Error(`Unexpected: ${url}`);
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("Set-Cookie header on successful OAuth callback has HttpOnly, Secure, SameSite=Lax", async () => {
    const state = generateOauthState();
    const res = await app.inject({
      method: "GET",
      url: `/auth/github/callback?code=abc&state=${state}`,
    });

    expect([200, 302]).toContain(res.statusCode);

    const setCookieHeader = res.headers["set-cookie"];
    const cookieStr = Array.isArray(setCookieHeader)
      ? setCookieHeader.find((c: string) => c.includes("pw_sid")) ?? ""
      : (setCookieHeader as string) ?? "";

    expect(cookieStr).toMatch(/HttpOnly/i);
    expect(cookieStr).toMatch(/Secure/i);
    expect(cookieStr).toMatch(/SameSite=Lax/i);
  });
});
