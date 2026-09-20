/**
 * b7_admin.test.ts — Phase B7
 *
 * Tests for admin panel routes:
 *   - Member management (view, correct, deactivate) — all audit-logged
 *   - Claim management (expire, restore, release) — all audit-logged
 *   - PR override — mandatory reason, audit-logged
 *   - Issue correction — audit-logged
 *   - Event control (deadline, registration)
 *   - Score snapshot and recompute (no-op, derived on-read)
 *   - CSV exports (members, claims, scores)
 *   - Audit log viewer (pagination, filters)
 *   - Bot control (history, dry-run, repost)
 *   - Admin guard (401, 403) re-checked server-side on every request
 *
 * All tests use in-memory mock DB — no network or real DB required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildApp } from "../src/app.js";
import { Department, Team, Tier, ClaimStatus, IssueLevel } from "@prisma/client";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Mock DB builder
// ---------------------------------------------------------------------------

function makeMockDb() {
  const members = new Map<string, any>();
  const sessions = new Map<string, any>();
  const claims = new Map<string, any>();
  const pullRequests = new Map<string, any>();
  const issues = new Map<string, any>();
  const repos = new Map<string, any>();
  const auditLogs: any[] = [];
  const botComments = new Map<string, any>();
  const systemConfigs = new Map<string, any>();

  // Admin member seed — githubUserId must match ADMIN_GITHUB_USER_IDS env (174175300)
  const adminMember = {
    id: "admin-id",
    githubUserId: BigInt(174175300),
    githubLogin: "admin-user",
    displayName: "Admin User",
    department: Department.technical,
    team: Team.NEXUS,
    tier: Tier.tech,
    isAdmin: true,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    pullRequests: [],
  };
  members.set("admin-id", adminMember);

  // Admin session — kept in map for default non-override lookup
  const adminSession = {
    id: "admin-session-id",
    memberId: "admin-id",
    tokenHash: "admin-token-hash",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 86400_000),
    revokedAt: null,
    member: adminMember,
  };
  sessions.set("admin-token-hash", adminSession);

  return {
    _members: members,
    _sessions: sessions,
    _claims: claims,
    _pullRequests: pullRequests,
    _issues: issues,
    _repos: repos,
    _auditLogs: auditLogs,
    _botComments: botComments,
    _systemConfigs: systemConfigs,

    $queryRaw: vi.fn(async () => [{ "?column?": 1 }]),

    systemConfig: {
      findMany: vi.fn(async ({ where }: any) => {
        const rows = Array.from(systemConfigs.values());
        if (where?.key?.in) {
          return rows.filter((r) => where.key.in.includes(r.key));
        }
        return rows;
      }),
      findUnique: vi.fn(async ({ where }: any) => systemConfigs.get(where.key) ?? null),
      upsert: vi.fn(async ({ where, update, create }: any) => {
        const existing = systemConfigs.get(where.key);
        const row = existing ? { ...existing, ...update } : { ...create, updatedAt: new Date() };
        systemConfigs.set(where.key, row);
        return row;
      }),
    },

    session: {
      findUnique: vi.fn(async ({ where, include }: any) => {
        const row = sessions.get(where.tokenHash) ?? null;
        if (!row) return null;
        if (include?.member) {
          const member = members.get(row.memberId) ?? null;
          return { ...row, member };
        }
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const [key, row] of sessions.entries()) {
          if (where.tokenHash && row.tokenHash !== where.tokenHash) continue;
          if (where.memberId && row.memberId !== where.memberId) continue;
          if (where.revokedAt === null && row.revokedAt !== null) continue;
          Object.assign(row, data);
          sessions.set(key, row);
          count++;
        }
        return { count };
      }),
    },

    $transaction: vi.fn(async (fn: any) => fn({
      member: {
        findUnique: vi.fn(async ({ where }: any) => members.get(where.id) ?? null),
        findFirst: vi.fn(async ({ where }: any) => {
          for (const m of members.values()) {
            if (where?.githubLogin && m.githubLogin.toLowerCase() === (where.githubLogin.equals || where.githubLogin).toLowerCase()) return m;
          }
          return null;
        }),
      },
      claim: {
        findFirst: vi.fn(async ({ where }: any) => {
          for (const c of claims.values()) {
            if (where?.issueId && c.issueId !== where.issueId) continue;
            if (where?.memberId && c.memberId !== where.memberId) continue;
            return c;
          }
          return null;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const c = claims.get(where.id);
          if (!c) throw new Error("Claim not found");
          const updated = { ...c, ...data };
          claims.set(where.id, updated);
          return updated;
        }),
        updateMany: vi.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const [key, c] of claims.entries()) {
            if (where?.issueId && c.issueId !== where.issueId) continue;
            if (where?.memberId && c.memberId !== where.memberId) continue;
            const updated = { ...c, ...data };
            claims.set(key, updated);
            count++;
          }
          return { count };
        }),
      },
      pullRequest: {
        findMany: vi.fn(async ({ where }: any) => {
          let rows = Array.from(pullRequests.values());
          if (where?.issueId) rows = rows.filter((r) => r.issueId === where.issueId);
          if (where?.id?.not) rows = rows.filter((r) => r.id !== where.id.not);
          return rows.map((r) => ({
            ...r,
            member: members.get(r.memberId) ?? null,
          }));
        }),
        findFirst: vi.fn(async ({ where }: any) => {
          for (const pr of pullRequests.values()) {
            if (where?.repoId && pr.repoId !== where.repoId) continue;
            if (where?.number && pr.number !== where.number) continue;
            return pr;
          }
          return null;
        }),
        create: vi.fn(async ({ data }: any) => {
          const id = `pr-${pullRequests.size + 1}`;
          const pr = { id, ...data };
          pullRequests.set(id, pr);
          return pr;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const pr = pullRequests.get(where.id);
          if (!pr) throw new Error("PR not found");
          const updated = { ...pr, ...data };
          pullRequests.set(where.id, updated);
          return updated;
        }),
      },
    })),

    member: {
      findMany: vi.fn(async ({ select, orderBy, where }: any) => {
        let rows = Array.from(members.values());
        if (where) {
          // Apply basic where filters
        }
        return rows.map((m) => ({
          id: m.id,
          githubUserId: m.githubUserId,
          githubLogin: m.githubLogin,
          displayName: m.displayName,
          department: m.department,
          team: m.team,
          tier: m.tier,
          isAdmin: m.isAdmin,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
          pullRequests: m.pullRequests ?? [],
        }));
      }),
      findUnique: vi.fn(async ({ where, include }: any) => {
        const m = members.get(where.id) ?? null;
        if (!m || !include) return m;
        if (include.pullRequests) {
          return { ...m, pullRequests: m.pullRequests ?? [] };
        }
        return m;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        for (const m of members.values()) {
          if (where?.githubLogin) {
            const val = where.githubLogin.equals || where.githubLogin;
            if (m.githubLogin.toLowerCase() === val.toLowerCase()) return m;
          }
        }
        return null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const m = members.get(where.id);
        if (!m) throw new Error("Member not found");
        const updated = { ...m, ...data, updatedAt: new Date() };
        members.set(where.id, updated);
        return updated;
      }),
    },

    claim: {
      findMany: vi.fn(async ({ where, include }: any) => {
        let rows = Array.from(claims.values());
        if (where?.memberId) rows = rows.filter((c) => c.memberId === where.memberId);
        if (where?.status?.in) rows = rows.filter((c) => where.status.in.includes(c.status));
        return rows.map((c) => ({
          ...c,
          member: members.get(c.memberId) ?? null,
          issue: issues.get(c.issueId) ?? null,
        }));
      }),
      findUnique: vi.fn(async ({ where, include }: any) => {
        const c = claims.get(where.id) ?? null;
        if (!c) return null;
        return {
          ...c,
          member: members.get(c.memberId) ?? null,
          issue: issues.get(c.issueId) ?? null,
        };
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        for (const c of claims.values()) {
          if (where?.issueId && c.issueId !== where.issueId) continue;
          if (where?.memberId && c.memberId !== where.memberId) continue;
          return c;
        }
        return null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const c = claims.get(where.id);
        if (!c) throw new Error("Claim not found");
        const updated = { ...c, ...data };
        claims.set(where.id, updated);
        return updated;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const [key, c] of claims.entries()) {
          if (where?.issueId && c.issueId !== where.issueId) continue;
          if (where?.memberId && c.memberId !== where.memberId) continue;
          const updated = { ...c, ...data };
          claims.set(key, updated);
          count++;
        }
        return { count };
      }),
    },

    pullRequest: {
      findMany: vi.fn(async ({ where }: any) => {
        let rows = Array.from(pullRequests.values());
        if (where?.issueId) rows = rows.filter((r) => r.issueId === where.issueId);
        return rows;
      }),
      findUnique: vi.fn(async ({ where, include }: any) => {
        const pr = pullRequests.get(where.id) ?? null;
        if (!pr) return null;
        return {
          ...pr,
          issue: issues.get(pr.issueId) ?? { id: pr.issueId, number: 21 },
          repo: repos.get(pr.repoId) ?? { owner: "AARVAK-VSET", name: "test-repo" },
          member: members.get(pr.memberId) ?? null,
        };
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        for (const pr of pullRequests.values()) {
          if (where?.repoId && pr.repoId !== where.repoId) continue;
          if (where?.number && pr.number !== where.number) continue;
          return pr;
        }
        return null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const id = `pr-${pullRequests.size + 1}`;
        const pr = { id, ...data };
        pullRequests.set(id, pr);
        return pr;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const pr = pullRequests.get(where.id);
        if (!pr) throw new Error("PR not found");
        const updated = { ...pr, ...data };
        pullRequests.set(where.id, updated);
        return updated;
      }),
    },

    issue: {
      findMany: vi.fn(async ({ take, skip, include }: any) => {
        let rows = Array.from(issues.values());
        if (skip) rows = rows.slice(skip);
        if (take) rows = rows.slice(0, take);
        return rows.map((i) => ({
          ...i,
          repo: repos.get(i.repoId) ?? { owner: "AARVAK-VSET", name: "test-repo" },
          _count: { claims: 0, waitlistEntries: 0 },
        }));
      }),
      findUnique: vi.fn(async ({ where }: any) => issues.get(where.id) ?? null),
      findFirst: vi.fn(async ({ where }: any) => {
        for (const i of issues.values()) {
          if (where?.repoId && i.repoId !== where.repoId) continue;
          if (where?.number && i.number !== where.number) continue;
          return i;
        }
        return null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const issue = issues.get(where.id);
        if (!issue) throw new Error("Issue not found");
        const updated = { ...issue, ...data };
        issues.set(where.id, updated);
        return updated;
      }),
    },

    auditLog: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `audit-${auditLogs.length}`, createdAt: new Date(), ...data };
        auditLogs.push(row);
        return row;
      }),
      findMany: vi.fn(async ({ take, skip, where, include, orderBy }: any) => {
        let rows = [...auditLogs].reverse(); // newest first
        if (where?.action) rows = rows.filter((r) => r.action === where.action);
        if (where?.targetType) rows = rows.filter((r) => r.targetType === where.targetType);
        if (skip) rows = rows.slice(skip);
        if (take) rows = rows.slice(0, take);
        return rows.map((r) => ({
          ...r,
          actorMember: r.actorMemberId ? members.get(r.actorMemberId) ?? null : null,
        }));
      }),
    },

    botComment: {
      findMany: vi.fn(async ({ take, skip, include }: any) => {
        let rows = Array.from(botComments.values()).reverse();
        if (skip) rows = rows.slice(skip);
        if (take) rows = rows.slice(0, take);
        return rows.map((c) => {
          const rawIssue = issues.get(c.issueId);
          const repo = rawIssue ? (repos.get(rawIssue.repoId) ?? { name: "test-repo" }) : { name: "test-repo" };
          const issue = rawIssue
            ? { number: rawIssue.number, repo }
            : { number: 1, repo: { name: "test-repo" } };
          return {
            ...c,
            issue,
            member: c.memberId ? members.get(c.memberId) ?? null : null,
          };
        });
      }),
      findUnique: vi.fn(async ({ where }: any) => botComments.get(where.id) ?? null),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `bot-${botComments.size}`, createdAt: new Date(), ...data };
        botComments.set(row.id, row);
        return row;
      }),
    },

    repo: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async ({ where }: any) => {
        for (const r of repos.values()) {
          if (where?.name) {
            const val = where.name.equals || where.name;
            if (r.name.toLowerCase() === val.toLowerCase()) return r;
          }
        }
        return null;
      }),
    },

    waitlistEntry: {
      findMany: vi.fn(async () => []),
    },
  } as any;
}

// ---------------------------------------------------------------------------
// Admin cookie helper
// ---------------------------------------------------------------------------

/**
 * Injects a request with the admin session cookie.
 *
 * Cookie name: pw_sid (SESSION_COOKIE_NAME from auth/session.ts)
 * readSessionToken reads request.cookies["pw_sid"], which returns the raw cookie value.
 * If unsignCookie is available and the value does NOT start with "s:", it falls through
 * to return the raw value directly (per the requestHelpers.ts logic).
 * resolveSession then calls hashToken(rawValue) → SHA-256 → db.session.findUnique.
 * Our addAdminSessionForRawToken override makes findUnique return the admin session for
 * any tokenHash, so the exact raw value doesn't matter.
 */
async function adminInject(
  app: FastifyInstance,
  method: string,
  url: string,
  payload?: unknown
) {
  const options: Parameters<FastifyInstance["inject"]>[0] = {
    method: method as any,
    url,
    headers: {
      // pw_sid is the SESSION_COOKIE_NAME; value is unsigned (no 's:' prefix)
      // readSessionToken falls through to return it as-is, then resolveSession hashes it
      cookie: `pw_sid=test-admin-raw-token`,
    },
    payload: payload !== undefined ? payload : undefined,
  };

  return app.inject(options);
}

// ---------------------------------------------------------------------------
// App + mock setup helpers
// ---------------------------------------------------------------------------

/**
 * Overrides db.session.findUnique to return a valid admin session for ANY tokenHash.
 * The admin member's githubUserId (174175300) must match ADMIN_GITHUB_USER_IDS in .env.
 * This avoids needing to pre-compute sha256(rawToken) in tests.
 */
function addAdminSessionForRawToken(db: ReturnType<typeof makeMockDb>) {
  const adminMember = db._members.get("admin-id");
  db.session.findUnique = vi.fn(async ({ where, include }: any) => {
    const adminSession = {
      id: "admin-session-id",
      memberId: "admin-id",
      tokenHash: where.tokenHash ?? "any",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400_000),
      revokedAt: null,
      member: adminMember,
    };
    // resolveSession always includes member, so always return it
    return adminSession;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Admin Guard — authentication required on all routes", () => {
  it("returns 401 when no session cookie provided", async () => {
    const db = makeMockDb();
    // Override session lookup to reject everything
    db.session.findUnique = vi.fn(async () => null);

    const app = await buildApp({
      prismaClient: db,
      disableLogging: true,
    });

    const res = await app.inject({ method: "GET", url: "/api/admin/members" });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 when authenticated but not in admin allowlist", async () => {
    const db = makeMockDb();
    // Non-admin member (githubUserId NOT in ADMIN_GITHUB_USER_IDS=12345)
    const nonAdmin = {
      id: "non-admin-id",
      githubUserId: BigInt(99999), // NOT 12345
      githubLogin: "regular-user",
      displayName: "Regular",
      department: Department.pr,
      team: Team.CIPHER,
      tier: Tier.general,
      isAdmin: false,
    };
    db._members.set("non-admin-id", nonAdmin);

    db.session.findUnique = vi.fn(async ({ where, include }: any) => ({
      id: "s",
      memberId: "non-admin-id",
      tokenHash: where.tokenHash,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400_000),
      revokedAt: null,
      member: include?.member ? nonAdmin : undefined,
    }));

    const app = await buildApp({
      prismaClient: db,
      disableLogging: true,
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/admin/members",
      headers: { cookie: "pw_sid=any-non-admin-token" },
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("Forbidden");
  });
});

describe("Admin Members — GET /api/admin/members", () => {
  it("returns all members for authenticated admin", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);

    // Add a regular member
    db._members.set("user-1", {
      id: "user-1",
      githubUserId: BigInt(111),
      githubLogin: "regular",
      displayName: "Regular User",
      department: Department.pr,
      team: Team.CIPHER,
      tier: Tier.general,
      isAdmin: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "GET", "/api/admin/members");

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.statusCode).toBe(200);
    expect(Array.isArray(body.members)).toBe(true);
    expect(body.count).toBeGreaterThanOrEqual(2); // admin + user-1
    // githubUserId should be string (BigInt serialised)
    expect(typeof body.members[0].githubUserId).toBe("string");
  });
});

describe("Admin Members — PATCH /api/admin/members/:id (correct department/team/tier)", () => {
  let db: ReturnType<typeof makeMockDb>;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = makeMockDb();
    addAdminSessionForRawToken(db);

    db._members.set("target-member", {
      id: "target-member",
      githubUserId: BigInt(777),
      githubLogin: "target",
      displayName: "Target User",
      department: Department.pr,
      team: Team.CIPHER,
      tier: Tier.general,
      isAdmin: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    app = await buildApp({ prismaClient: db, disableLogging: true });
  });

  it("corrects department and writes audit log", async () => {
    const res = await adminInject(app, "PATCH", "/api/admin/members/target-member", {
      department: Department.technical,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.member.department).toBe(Department.technical);

    // Audit log must be written
    expect(db._auditLogs).toHaveLength(1);
    expect(db._auditLogs[0].action).toBe("member_corrected");
    expect(db._auditLogs[0].targetId).toBe("target-member");
    const before = JSON.parse(db._auditLogs[0].beforeJson);
    expect(before.department).toBe(Department.pr); // Original value
  });

  it("corrects team with audit log", async () => {
    const res = await adminInject(app, "PATCH", "/api/admin/members/target-member", {
      team: Team.NEXUS,
    });
    expect(res.statusCode).toBe(200);
    expect(db._auditLogs.some((l: any) => l.action === "member_corrected")).toBe(true);
  });

  it("returns 400 if no fields provided", async () => {
    const res = await adminInject(app, "PATCH", "/api/admin/members/target-member", {});
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for non-existent member", async () => {
    const res = await adminInject(app, "PATCH", "/api/admin/members/does-not-exist", {
      team: Team.ECHO,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("Admin Members — PATCH /api/admin/members/:id/deactivate", () => {
  it("deactivates member and revokes sessions, writes audit log", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);

    const targetId = "target-to-deactivate";
    db._members.set(targetId, {
      id: targetId,
      githubUserId: BigInt(888),
      githubLogin: "about-to-be-deactivated",
      displayName: "Target",
      department: Department.design,
      team: Team.BYTE_BRIGADE,
      tier: Tier.general,
      isAdmin: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Seed an active session for target
    db._sessions.set("target-token", {
      id: "s-target",
      memberId: targetId,
      tokenHash: "target-token",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 86400_000),
    });

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "PATCH", `/api/admin/members/${targetId}/deactivate`, {
      reason: "Test deactivation reason",
    });

    expect(res.statusCode).toBe(200);
    expect(db._auditLogs.some((l: any) => l.action === "member_deactivated")).toBe(true);
    // session.updateMany should have been called to revoke sessions
    expect(db.session.updateMany).toHaveBeenCalled();
  });

  it("returns 400 if reason is too short", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);
    db._members.set("m", { id: "m", githubUserId: BigInt(1), githubLogin: "x", displayName: "X", department: Department.pr, team: Team.ECHO, tier: Tier.general, isAdmin: false, createdAt: new Date(), updatedAt: new Date() });

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "PATCH", "/api/admin/members/m/deactivate", { reason: "hi" });
    expect(res.statusCode).toBe(400);
  });
});

describe("Admin Claims — POST /api/admin/claims/:id/expire", () => {
  let db: ReturnType<typeof makeMockDb>;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = makeMockDb();
    addAdminSessionForRawToken(db);

    const issueId = "issue-1";
    db._issues.set(issueId, {
      id: issueId,
      repoId: "repo-1",
      number: 42,
      title: "Test Issue",
      level: IssueLevel.medium,
      spots: 2,
      githubIssueId: BigInt(9000),
    });
    db._repos.set("repo-1", { id: "repo-1", owner: "AARVAK-VSET", name: "test-repo", githubRepoId: BigInt(1) });

    db._claims.set("claim-1", {
      id: "claim-1",
      memberId: "admin-id",
      issueId,
      commentId: BigInt(1),
      claimedAt: new Date(),
      deadline: new Date(Date.now() + 3_600_000),
      status: ClaimStatus.active,
      promotedAt: null,
    });

    app = await buildApp({ prismaClient: db, disableLogging: true });
  });

  it("expires an active claim and writes audit log", async () => {
    const res = await adminInject(app, "POST", "/api/admin/claims/claim-1/expire", {
      reason: "Admin test expiry",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.message).toContain("expired");

    expect(db._auditLogs.some((l: any) => l.action === "claim_expired_by_admin")).toBe(true);
    const claim = db._claims.get("claim-1");
    expect(claim.status).toBe(ClaimStatus.expired);
  });

  it("returns 409 if claim is already merged", async () => {
    db._claims.set("claim-merged", {
      id: "claim-merged",
      memberId: "admin-id",
      issueId: "issue-1",
      commentId: BigInt(2),
      claimedAt: new Date(),
      deadline: new Date(),
      status: ClaimStatus.merged,
      promotedAt: null,
    });

    const res = await adminInject(app, "POST", "/api/admin/claims/claim-merged/expire", {
      reason: "Should not work",
    });
    expect(res.statusCode).toBe(409);
  });

  it("returns 400 if reason is too short", async () => {
    const res = await adminInject(app, "POST", "/api/admin/claims/claim-1/expire", {
      reason: "hi",
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for non-existent claim", async () => {
    const res = await adminInject(app, "POST", "/api/admin/claims/no-such-claim/expire", {
      reason: "Does not matter",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("Admin Claims — POST /api/admin/claims/:id/restore", () => {
  it("restores an expired claim with fresh deadline and writes audit log", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);

    db._claims.set("expired-claim", {
      id: "expired-claim",
      memberId: "admin-id",
      issueId: "issue-x",
      commentId: BigInt(1),
      claimedAt: new Date(),
      deadline: new Date(Date.now() - 3_600_000), // past
      status: ClaimStatus.expired,
      promotedAt: null,
    });

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "POST", "/api/admin/claims/expired-claim/restore", {
      reason: "Restoring due to extenuating circumstances",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.newDeadline).toBeDefined();
    expect(new Date(body.newDeadline) > new Date()).toBe(true); // fresh future deadline

    expect(db._auditLogs.some((l: any) => l.action === "claim_restored_by_admin")).toBe(true);
    const claim = db._claims.get("expired-claim");
    expect(claim.status).toBe(ClaimStatus.active);
  });

  it("returns 409 if claim is already active", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);

    db._claims.set("active-claim", {
      id: "active-claim",
      memberId: "admin-id",
      issueId: "issue-x",
      commentId: BigInt(1),
      claimedAt: new Date(),
      deadline: new Date(Date.now() + 3_600_000),
      status: ClaimStatus.active,
      promotedAt: null,
    });

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "POST", "/api/admin/claims/active-claim/restore", {
      reason: "Should fail since not expired",
    });
    expect(res.statusCode).toBe(409);
  });
});

describe("Admin PR Override — PATCH /api/admin/prs/:id/override", () => {
  it("marks PR as not counting with mandatory reason, writes audit log", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);

    db._pullRequests.set("pr-1", {
      id: "pr-1",
      memberId: "admin-id",
      issueId: "issue-1",
      number: 42,
      githubPrId: BigInt(999),
      repoId: "repo-1",
      openedAt: new Date(),
      merged: true,
      countsForScore: true,
    });

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "PATCH", "/api/admin/prs/pr-1/override", {
      countsForScore: false,
      reason: "Empty PR with no meaningful changes per § 2.7",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.pr.countsForScore).toBe(false);

    expect(db._auditLogs.some((l: any) => l.action === "pr_override")).toBe(true);
    const auditEntry = db._auditLogs.find((l: any) => l.action === "pr_override");
    const after = JSON.parse(auditEntry.afterJson);
    expect(after.reason).toContain("Empty PR");
    expect(after.countsForScore).toBe(false);

    const pr = db._pullRequests.get("pr-1");
    expect(pr.countsForScore).toBe(false);
  });

  it("returns 400 if reason is missing or too short", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);
    db._pullRequests.set("pr-x", { id: "pr-x", memberId: "admin-id", issueId: "i", number: 1, githubPrId: BigInt(1), repoId: "r", openedAt: new Date(), merged: false, countsForScore: true });

    const app = await buildApp({ prismaClient: db, disableLogging: true });

    // Missing reason
    const res1 = await adminInject(app, "PATCH", "/api/admin/prs/pr-x/override", {
      countsForScore: false,
    });
    expect(res1.statusCode).toBe(400);

    // Too short reason (< 10 chars)
    const res2 = await adminInject(app, "PATCH", "/api/admin/prs/pr-x/override", {
      countsForScore: false,
      reason: "short",
    });
    expect(res2.statusCode).toBe(400);
  });

  it("can restore a PR to countsForScore=true (re-enabling)", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);
    db._pullRequests.set("pr-2", { id: "pr-2", memberId: "admin-id", issueId: "i", number: 2, githubPrId: BigInt(2), repoId: "r", openedAt: new Date(), merged: true, countsForScore: false });

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "PATCH", "/api/admin/prs/pr-2/override", {
      countsForScore: true,
      reason: "Reverting override after review confirmed valid contribution",
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).pr.countsForScore).toBe(true);
  });
});

describe("Admin Issues — PATCH /api/admin/issues/:id", () => {
  it("corrects issue level and writes audit log", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);

    db._issues.set("issue-A", {
      id: "issue-A",
      repoId: "repo-1",
      number: 10,
      title: "Test",
      level: IssueLevel.easy,
      spots: 2,
      githubIssueId: BigInt(100),
    });

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "PATCH", "/api/admin/issues/issue-A", {
      level: IssueLevel.medium,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.issue.level).toBe(IssueLevel.medium);
    expect(db._auditLogs.some((l: any) => l.action === "issue_corrected")).toBe(true);
  });

  it("closes issue for claiming by setting spots=0", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);

    db._issues.set("issue-B", {
      id: "issue-B",
      repoId: "repo-1",
      number: 11,
      title: "Test",
      level: IssueLevel.hard,
      spots: 3,
      githubIssueId: BigInt(101),
    });

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "PATCH", "/api/admin/issues/issue-B", { closed: true });

    expect(res.statusCode).toBe(200);
    const issue = db._issues.get("issue-B");
    expect(issue.spots).toBe(0);
  });

  it("returns 400 if no fields provided", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);
    db._issues.set("issue-C", { id: "issue-C", repoId: "r", number: 1, title: "T", level: IssueLevel.easy, spots: 1, githubIssueId: BigInt(1) });

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "PATCH", "/api/admin/issues/issue-C", {});
    expect(res.statusCode).toBe(400);
  });
});

describe("Admin Event Control — GET and PATCH /api/admin/event", () => {
  it("returns event settings (registration state, deadline)", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);

    db._systemConfigs.set("registration_open", { key: "registration_open", value: "true", updatedAt: new Date() });
    db._systemConfigs.set("final_deadline", { key: "final_deadline", value: "2026-11-30T23:59:59Z", updatedAt: new Date() });

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "GET", "/api/admin/event");

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.registrationOpen).toBe(true);
    expect(body.finalDeadline).toBe("2026-11-30T23:59:59Z");
  });

  it("sets final deadline and writes audit log", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "PATCH", "/api/admin/event", {
      finalDeadline: "2026-12-01T00:00:00Z",
    });

    expect(res.statusCode).toBe(200);
    expect(db._auditLogs.some((l: any) => l.action === "final_deadline_set")).toBe(true);
  });

  it("closes registration and writes audit log", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "PATCH", "/api/admin/event", { open: false });

    expect(res.statusCode).toBe(200);
    expect(db._auditLogs.some((l: any) => l.action === "registration_locked")).toBe(true);
  });

  it("returns 400 if neither open nor finalDeadline provided", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "PATCH", "/api/admin/event", {});
    expect(res.statusCode).toBe(400);
  });
});

describe("Admin Scores — GET /api/admin/scores/snapshot and POST /api/admin/scores/recompute", () => {
  it("snapshot returns memberScores and teamScores arrays", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);

    // member.findMany returns admin-id only with no PRs
    db.member.findMany = vi.fn(async () => [{ id: "admin-id" }]);
    db.member.findUnique = vi.fn(async () => ({
      id: "admin-id",
      displayName: "Admin",
      githubLogin: "admin-user",
      department: Department.technical,
      team: Team.NEXUS,
      tier: Tier.tech,
      pullRequests: [],
    }));

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "GET", "/api/admin/scores/snapshot");

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.memberScores)).toBe(true);
    expect(Array.isArray(body.teamScores)).toBe(true);
    expect(body.memberScores[0].githubLogin).toBe("admin-user");
    expect(body.memberScores[0].raw).toBe(0);
    expect(body.memberScores[0].capped).toBe(0);
  });

  it("recompute returns scores and writes audit log", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);

    db.member.findMany = vi.fn(async () => [{ id: "admin-id" }]);
    db.member.findUnique = vi.fn(async () => ({
      id: "admin-id",
      displayName: "Admin",
      githubLogin: "admin-user",
      department: Department.technical,
      team: Team.NEXUS,
      tier: Tier.tech,
      pullRequests: [],
    }));

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "POST", "/api/admin/scores/recompute");

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.message).toContain("derived on read");
    expect(typeof body.memberCount).toBe("number");
    expect(db._auditLogs.some((l: any) => l.action === "scores_recomputed")).toBe(true);
  });
});

describe("Admin CSV Exports", () => {
  it("GET /api/admin/export/members returns CSV with correct headers", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "GET", "/api/admin/export/members");

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("members.csv");

    const lines = res.body.split("\r\n");
    expect(lines[0]).toContain("githubLogin");
    expect(lines[0]).toContain("department");
    expect(lines[0]).toContain("team");
  });

  it("GET /api/admin/export/claims returns CSV", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "GET", "/api/admin/export/claims");

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
  });

  it("GET /api/admin/export/scores returns CSV with member scores", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);

    db.member.findMany = vi.fn(async () => [{ id: "admin-id" }]);
    db.member.findUnique = vi.fn(async () => ({
      id: "admin-id",
      displayName: "Admin",
      githubLogin: "admin-user",
      department: Department.technical,
      team: Team.NEXUS,
      tier: Tier.tech,
      pullRequests: [],
    }));

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "GET", "/api/admin/export/scores");

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const lines = res.body.split("\r\n");
    expect(lines[0]).toContain("rank");
    expect(lines[0]).toContain("capped");
    expect(lines[0]).toContain("tierCap");
  });
});

describe("Admin Audit Log — GET /api/admin/audit-log", () => {
  it("returns audit log entries, newest first", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);

    // Seed some audit entries
    db._auditLogs.push({ id: "a1", action: "member_corrected", targetType: "Member", targetId: "m1", actorMemberId: null, actorIp: "127.0.0.1", beforeJson: null, afterJson: null, createdAt: new Date("2026-01-01") });
    db._auditLogs.push({ id: "a2", action: "claim_expired_by_admin", targetType: "Claim", targetId: "c1", actorMemberId: null, actorIp: "127.0.0.1", beforeJson: null, afterJson: null, createdAt: new Date("2026-01-02") });

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "GET", "/api/admin/audit-log");

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.auditLog)).toBe(true);
    expect(body.count).toBeGreaterThanOrEqual(2);
    // Newest first: "claim_expired_by_admin" (2026-01-02) before "member_corrected" (2026-01-01)
    expect(body.auditLog[0].action).toBe("claim_expired_by_admin");
  });

  it("supports action filter via ?action=", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);

    db._auditLogs.push({ id: "a1", action: "member_corrected", targetType: "Member", targetId: "m1", actorMemberId: null, actorIp: "127.0.0.1", beforeJson: null, afterJson: null, createdAt: new Date() });
    db._auditLogs.push({ id: "a2", action: "pr_override", targetType: "PullRequest", targetId: "pr1", actorMemberId: null, actorIp: "127.0.0.1", beforeJson: null, afterJson: null, createdAt: new Date() });

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "GET", "/api/admin/audit-log?action=pr_override");

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.auditLog.every((l: any) => l.action === "pr_override")).toBe(true);
  });
});

describe("Admin Bot Control", () => {
  it("GET /api/admin/bot/dry-run returns current dry-run setting", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "GET", "/api/admin/bot/dry-run");

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body.dryRun).toBe("boolean");
  });

  it("PATCH /api/admin/bot/dry-run enables dry-run and writes audit log", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "PATCH", "/api/admin/bot/dry-run", { enabled: true });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.dryRun).toBe(true);
    expect(db._auditLogs.some((l: any) => l.action === "bot_dry_run_enabled")).toBe(true);

    // Verify systemConfig was updated
    expect(db.systemConfig.upsert).toHaveBeenCalled();
  });

  it("PATCH /api/admin/bot/dry-run disables dry-run", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "PATCH", "/api/admin/bot/dry-run", { enabled: false });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).dryRun).toBe(false);
    expect(db._auditLogs.some((l: any) => l.action === "bot_dry_run_disabled")).toBe(true);
  });

  it("GET /api/admin/bot/history returns bot comment records", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);

    // Seed a bot comment
    db._botComments.set("bc-1", {
      id: "bc-1",
      issueId: "issue-x",
      memberId: null,
      commentId: BigInt(555),
      kind: "claim_accepted",
      createdAt: new Date(),
    });
    db._issues.set("issue-x", { id: "issue-x", number: 7, repoId: "r1", title: "T", level: IssueLevel.easy, spots: 1, githubIssueId: BigInt(7) });
    db._repos.set("r1", { id: "r1", owner: "AARVAK-VSET", name: "test-repo", githubRepoId: BigInt(1) });

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "GET", "/api/admin/bot/history");

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.comments)).toBe(true);
    expect(body.comments[0].kind).toBe("claim_accepted");
    expect(body.comments[0].commentId).toBe("555"); // BigInt serialised to string
  });
});

describe("Admin Manual PR Link — POST /api/admin/prs/link", () => {
  it("manually links a PR to an issue/claim, updates claim to pr_raised and writes audit log", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);

    const memberId = "mem-roboticol";
    db._members.set(memberId, {
      id: memberId,
      githubUserId: BigInt(99123),
      githubLogin: "Roboticol",
      displayName: "Roboticol",
      department: Department.technical,
      team: Team.NEXUS,
      tier: Tier.tech,
      isAdmin: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const repoId = "repo-campus";
    db._repos.set(repoId, {
      id: repoId,
      owner: "AARVAK-VSET",
      name: "campus-flow",
      githubRepoId: BigInt(10),
    });

    const issueId = "issue-19";
    db._issues.set(issueId, {
      id: issueId,
      repoId,
      number: 19,
      title: "Flow bug",
      level: IssueLevel.medium,
      spots: 1,
      githubIssueId: BigInt(1900),
    });

    const claimId = "claim-19";
    db._claims.set(claimId, {
      id: claimId,
      memberId,
      issueId,
      commentId: BigInt(123),
      claimedAt: new Date(),
      deadline: new Date(Date.now() + 3600_000),
      status: ClaimStatus.active,
      promotedAt: null,
    });

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "POST", "/api/admin/prs/link", {
      repoOwner: "AARVAK-VSET",
      repoName: "campus-flow",
      prNumber: 27,
      issueNumber: 19,
      memberLogin: "Roboticol",
      reason: "Recovery for missed webhook delivery",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.pullRequest.number).toBe(27);
    expect(body.pullRequest.issueId).toBe(issueId);
    expect(body.pullRequest.countsForScore).toBe(true);
    expect(body.claim.status).toBe(ClaimStatus.pr_raised);

    const claimInDb = db._claims.get(claimId);
    expect(claimInDb.status).toBe(ClaimStatus.pr_raised);

    expect(db._auditLogs.some((l: any) => l.action === "pr_manually_linked")).toBe(true);
  });

  it("returns 404 when repo or issue does not exist", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);

    const app = await buildApp({ prismaClient: db, disableLogging: true });
    const res = await adminInject(app, "POST", "/api/admin/prs/link", {
      repoOwner: "AARVAK-VSET",
      repoName: "nonexistent-repo",
      prNumber: 1,
      issueNumber: 1,
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("Admin PRs — POST /api/admin/prs/:id/merge-decision (lock both sides and audit)", () => {
  it("locks target PR to merged=true and competing PR to merged=false, updating claims and writing audits", async () => {
    const db = makeMockDb();
    addAdminSessionForRawToken(db);

    const issueId = "issue-21";
    const repoId = "repo-1";

    db._issues.set(issueId, { id: issueId, number: 21, repoId });
    db._repos.set(repoId, { id: repoId, owner: "AARVAK-VSET", name: "aqua-sense" });

    // Seed competing PR 30 (author mem-1)
    db._pullRequests.set("pr-30", {
      id: "pr-30",
      repoId,
      number: 30,
      githubPrId: BigInt(3000),
      memberId: "mem-1",
      issueId,
      openedAt: new Date(),
      merged: true,
      countsForScore: true,
      mergeDecisionLocked: false,
    });
    db._claims.set("claim-30", {
      id: "claim-30",
      issueId,
      memberId: "mem-1",
      status: ClaimStatus.merged,
    });

    // Seed target PR 24 (author mem-2)
    db._pullRequests.set("pr-24", {
      id: "pr-24",
      repoId,
      number: 24,
      githubPrId: BigInt(2400),
      memberId: "mem-2",
      issueId,
      openedAt: new Date(),
      merged: false,
      countsForScore: true,
      mergeDecisionLocked: false,
    });
    db._claims.set("claim-24", {
      id: "claim-24",
      issueId,
      memberId: "mem-2",
      status: ClaimStatus.pr_raised,
    });

    const app = await buildApp({ prismaClient: db, disableLogging: true });

    // Admin sets PR 24 to merged=true with reason
    const res = await adminInject(app, "POST", "/api/admin/prs/pr-24/merge-decision", {
      merged: true,
      countsForScore: true,
      reason: "Organiser decision: PR 24 quality wins",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.pullRequest.merged).toBe(true);
    expect(body.pullRequest.mergeDecisionLocked).toBe(true);
    expect(body.competingUpdated).toHaveLength(1);
    expect(body.competingUpdated[0].id).toBe("pr-30");
    expect(body.competingUpdated[0].merged).toBe(false);
    expect(body.competingUpdated[0].mergeDecisionLocked).toBe(true);

    // Verify DB state
    const updatedPr24 = db._pullRequests.get("pr-24");
    const updatedPr30 = db._pullRequests.get("pr-30");
    expect(updatedPr24.merged).toBe(true);
    expect(updatedPr24.mergeDecisionLocked).toBe(true);
    expect(updatedPr30.merged).toBe(false);
    expect(updatedPr30.mergeDecisionLocked).toBe(true);

    // Verify Claims
    const claim24 = db._claims.get("claim-24");
    const claim30 = db._claims.get("claim-30");
    expect(claim24.status).toBe(ClaimStatus.merged);
    expect(claim30.status).toBe(ClaimStatus.pr_raised);

    // Verify Audit Logs
    expect(db._auditLogs.some((l: any) => l.action === "pr_merge_decision" && l.targetId === "pr-24")).toBe(true);
    expect(db._auditLogs.some((l: any) => l.action === "pr_merge_decision_demoted" && l.targetId === "pr-30")).toBe(true);
  });
});


