# Patch Wars 2026 — Tracker

The backend service that powers the Patch Wars 2026 open-source challenge.  
It handles GitHub OAuth login, claim/unclaim processing via webhook, PR scoring, leaderboards, and the admin control panel.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Environment Variables](#environment-variables)
3. [GitHub App Setup](#github-app-setup)
4. [Running Locally](#running-locally)
5. [Database Migrations](#database-migrations)
6. [Running Tests](#running-tests)
7. [Admin Panel](#admin-panel)
8. [Operations Runbook](#operations-runbook)
9. [Backup & Restore](#backup--restore)

---

## Architecture

```
tracker/
  src/
    app.ts              — Fastify app builder (CORS, Helmet, rate-limit, CSRF)
    config.ts           — Zod-validated env config
    db.ts               — Prisma client singleton
    auth/               — OAuth state, session management, admin guard
    domain/             — Business logic (claimEngine, prEngine, scoring, expirySweep)
    routes/             — HTTP route handlers (admin, auth, dashboard, issues, leaderboard, registration)
    webhooks/           — GitHub webhook handler (HMAC verification)
    github/             — GitHub API client, bot comment posting
    importer/           — Bulk issue import from manifest JSON
  prisma/
    schema.prisma       — Database schema
    migrations/         — Applied migrations
  tests/                — Vitest unit + integration tests (no real DB)
  scripts/              — Seed, teardown, backup scripts
  web/                  — React/Vite frontend (builds to web/dist/)
```

Scores are **always derived on read** from raw PR events — never stored as static values. This ensures a single source of truth and makes every historical score auditable.

---

## Environment Variables

All variables are validated at startup via Zod. The server exits immediately if any required variable is missing or malformed.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string (must include `?pgbouncer=true` for Supabase pooler) |
| `DIRECT_URL` | ✅ | Direct PostgreSQL connection (no PgBouncer, used by Prisma migrations) |
| `TEST_DATABASE_URL` | ✅ (for `npm test`) | Test PostgreSQL connection string pointing to dedicated test schema (must include `?schema=patchwars_test`) |
| `TEST_DIRECT_URL` | optional | Direct test connection for session-mode concurrency tests (must include `?schema=patchwars_test`) |
| `SESSION_SECRET` | ✅ | ≥32 chars. Used to sign session cookies. Generate with: `openssl rand -hex 32` |
| `ADMIN_GITHUB_USER_IDS` | ✅ | Comma-separated numeric GitHub User IDs of admins, e.g. `12345,67890` |
| `CORS_ORIGIN` | ✅ | Comma-separated allowed origins, e.g. `https://tracker.example.com`. Wildcards are FORBIDDEN. |
| `GITHUB_CLIENT_ID` | ✅ (OAuth) | GitHub OAuth App Client ID |
| `GITHUB_CLIENT_SECRET` | ✅ (OAuth) | GitHub OAuth App Client Secret |
| `GITHUB_APP_ID` | ✅ (webhooks) | GitHub App ID (numeric) |
| `GITHUB_APP_PRIVATE_KEY` | ✅ (webhooks) | GitHub App private key PEM (base64 or raw) |
| `GITHUB_WEBHOOK_SECRET` | ✅ (webhooks) | HMAC secret for webhook signature verification |
| `GITHUB_APP_BOT_USER_ID` | ✅ (bot) | Numeric GitHub User ID of the bot account (so it ignores its own comments) |
| `FINAL_DEADLINE` | optional | ISO-8601 datetime. PRs merged after this score zero. Can also be set via admin panel. |
| `SWEEP_SECRET` | optional | Shared secret for `POST /internal/sweep` (external scheduler trigger) |
| `CLAIM_TTL_HOURS` | optional | Claim deadline duration in hours. Default: `48` |
| `BOT_DRY_RUN` | optional | Set to `true` to disable actual GitHub comment posting. Default: `false` |
| `NODE_ENV` | optional | `development` / `production` / `test`. Default: `development` |
| `PORT` | optional | HTTP listen port. Default: `3000` |
| `HOST` | optional | HTTP listen host. Default: `0.0.0.0` |

### Example `.env`

```env
DATABASE_URL=postgresql://user:pass@db.supabase.co:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://user:pass@db.supabase.co:5432/postgres
TEST_DATABASE_URL=postgresql://user:pass@db.supabase.co:6543/postgres?pgbouncer=true&schema=patchwars_test
TEST_DIRECT_URL=postgresql://user:pass@db.supabase.co:5432/postgres?schema=patchwars_test
SESSION_SECRET=your-super-secret-32-char-minimum-value-here
ADMIN_GITHUB_USER_IDS=12345,67890
CORS_ORIGIN=https://tracker.patchwarstracker.com
GITHUB_CLIENT_ID=Ov23xxxxxxxxxxxxx
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GITHUB_APP_ID=12345
GITHUB_APP_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\n...
GITHUB_WEBHOOK_SECRET=your-webhook-secret
GITHUB_APP_BOT_USER_ID=111222333
FINAL_DEADLINE=2026-11-30T23:59:59Z
CLAIM_TTL_HOURS=48
```

---

## GitHub App Setup

### OAuth App (for participant login)

1. Go to GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. **Authorization callback URL**: `https://your-domain.com/auth/github/callback`
3. **Requested scopes**: `read:user` only (no `repo`, no write scopes)
4. Copy **Client ID** → `GITHUB_CLIENT_ID`
5. Generate a **Client Secret** → `GITHUB_CLIENT_SECRET`

### GitHub App (for bot comments and webhooks)

1. Go to GitHub → Settings → Developer settings → GitHub Apps → New GitHub App
2. **Permissions** (Repository permissions):
   - `Issues` → Read & write (to post comments)
   - `Pull requests` → Read-only
3. **Subscribe to events**: `Issue comment`, `Pull request`
4. **Webhook URL**: `https://your-domain.com/webhooks/github`
5. **Webhook secret**: set a random secret → `GITHUB_WEBHOOK_SECRET`
6. After creation, note the **App ID** → `GITHUB_APP_ID`
7. Generate a **private key** (PEM file) → `GITHUB_APP_PRIVATE_KEY`
8. Install the App on each target repository (AARVAK-VSET org)
9. Note the bot account's numeric user ID → `GITHUB_APP_BOT_USER_ID`

---

## Running Locally

```bash
# Install dependencies
npm install

# Generate Prisma client
npm run prisma:generate

# Apply migrations
npm run prisma:migrate

# Start development server (hot-reload)
npm run dev

# Build and start production server
npm run build
npm start
```

Frontend (in a separate terminal):
```bash
cd web
npm install
npm run dev
```

---

## Database Migrations

```bash
# Create a new migration after changing schema.prisma
npx prisma migrate dev --name <migration-name>

# Apply migrations in production (no interactive prompts)
npx prisma migrate deploy

# Reset database (destroys all data — development only)
npx prisma migrate reset
```

---

## Running Tests

The test suite requires `TEST_DATABASE_URL` pointing to an isolated PostgreSQL schema (`?schema=patchwars_test`).

### Fail-Safe Test Guard
A global test guard (`tests/setup.ts` and `src/db.ts`) verifies the connection string before any test runs. If `TEST_DATABASE_URL` is missing or lacks `?schema=patchwars_test`, the test suite aborts immediately with a fatal error. Tests are **physically prohibited** from falling back to `DATABASE_URL` or touching the production database schema.

```bash
# Run all tests once (uses TEST_DATABASE_URL from .env)
npm test

# Watch mode
npm run test:watch

# Run specific test file
npx vitest run tests/rehearsal.test.ts
npx vitest run tests/scoring.test.ts
npx vitest run tests/b7_admin.test.ts
npx vitest run tests/concurrency.test.ts
```

All tests that create temporary database fixtures automatically clean up after themselves in `afterEach` / `afterAll`.

---

## Admin Panel

All admin routes are at `/api/admin/*` and require:
1. A valid session cookie (`tracker_session`)
2. The session member's **numeric GitHub User ID** to be in `ADMIN_GITHUB_USER_IDS`

This check is re-performed server-side on **every request** — there is no client-influenceable role field.

### Key Admin Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/members` | List all members |
| `PATCH` | `/api/admin/members/:id` | Correct department/team/tier (audited) |
| `PATCH` | `/api/admin/members/:id/deactivate` | Deactivate member, revoke sessions (audited) |
| `GET` | `/api/admin/claims` | List claims (`?status=active`) |
| `POST` | `/api/admin/claims/:id/expire` | Manually expire a claim (audited) |
| `POST` | `/api/admin/claims/:id/restore` | Restore expired claim (audited) |
| `POST` | `/api/admin/claims/:id/release` | Force-release a claim (audited) |
| `PATCH` | `/api/admin/prs/:id/override` | Mark PR as not counting — **reason required** (audited) |
| `GET` | `/api/admin/issues` | List all issues |
| `PATCH` | `/api/admin/issues/:id` | Correct level/spots, close issue (audited) |
| `GET` | `/api/admin/event` | Get event settings |
| `PATCH` | `/api/admin/event` | Set deadline / toggle registration (audited) |
| `POST` | `/api/admin/scores/recompute` | Trigger score derivation (no-op, always live) |
| `GET` | `/api/admin/scores/snapshot` | Full score snapshot (members + teams) |
| `GET` | `/api/admin/export/members` | CSV export — members |
| `GET` | `/api/admin/export/claims` | CSV export — claims |
| `GET` | `/api/admin/export/scores` | CSV export — member scores |
| `GET` | `/api/admin/audit-log` | Audit log (`?action=&targetType=&limit=&offset=`) |
| `GET` | `/api/admin/bot/history` | Bot comment history |
| `PATCH` | `/api/admin/bot/dry-run` | Enable/disable bot dry-run |
| `POST` | `/api/admin/bot/repost` | Re-post a failed bot comment |
| `PATCH` | `/api/admin/registration/lock` | Open/close registration |
| `POST` | `/api/admin/sessions/revoke` | Revoke a session by token hash |

---

## Operations Runbook

### Claim Expiry Sweep

The sweep runs automatically:
- Every 5 minutes via `setInterval` in-process
- Opportunistically at the start of every webhook/API request (at most once/minute)
- Via `POST /internal/sweep` (authenticated by `SWEEP_SECRET`) for external schedulers

If sweeps are falling behind, set up an external cron:
```bash
curl -s -X POST https://your-domain.com/internal/sweep \
  -H "Authorization: Bearer ${SWEEP_SECRET}"
```

### Bot Dry-Run Mode

To pause bot comments without restarting:
```bash
curl -s -X PATCH https://your-domain.com/api/admin/bot/dry-run \
  -H "Cookie: tracker_session=<your-admin-session>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

### Setting the Final Deadline

```bash
curl -s -X PATCH https://your-domain.com/api/admin/event \
  -H "Cookie: tracker_session=<your-admin-session>" \
  -H "Content-Type: application/json" \
  -d '{"finalDeadline": "2026-11-30T23:59:59Z"}'
```

### Health Check

```bash
curl -s https://your-domain.com/health
# {"status":"ok","db":"connected","timestamp":"..."}
```

### Closing Registration

```bash
curl -s -X PATCH https://your-domain.com/api/admin/event \
  -H "Cookie: tracker_session=<your-admin-session>" \
  -H "Content-Type: application/json" \
  -d '{"open": false}'
```

### Disqualifying a PR (§ 2.7)

```bash
curl -s -X PATCH https://your-domain.com/api/admin/prs/<pr-uuid>/override \
  -H "Cookie: tracker_session=<your-admin-session>" \
  -H "Content-Type: application/json" \
  -d '{"countsForScore": false, "reason": "Empty PR with no real changes per § 2.7"}'
```

The reason is mandatory (≥10 chars) and is written to the audit log.

---

## Deployment (Render Web Service)

The Tracker runs on a single **Render Free Web Service** (512 MB RAM, 0.1 CPU) serving both the backend Fastify API and the compiled React SPA from the same origin.

### Render Service Settings

| Setting | Value | Description |
|---|---|---|
| **Environment** | Node | Node.js runtime |
| **Build Command** | `npm run build` | Builds `web/dist`, runs `prisma generate`, compiles TypeScript server |
| **Start Command** | `npm start` | Launches Fastify server via `node dist/index.js` |
| **Pre-Deploy Command** | `npx prisma migrate deploy` | Applies pending migrations using `DIRECT_URL` before boot |

> [!IMPORTANT]
> Always run migrations in the **Pre-Deploy Command** using `DIRECT_URL` (direct port 5432, not PgBouncer). Never run migrations at application startup so a failed migration does not leave a half-started service.

### Keep-Alive & Expiry Sweep Workflow (GitHub Actions)

Because Render free web services sleep after 15 minutes of inactivity, a lightweight GitHub Actions workflow keeps the service awake and triggers opportunistic sweeps during the competition.

Create `.github/workflows/keepalive.yml`:

```yaml
name: Tracker Keep-Alive & Sweep
on:
  schedule:
    - cron: '*/5 * * * *' # Every 5 minutes during the event
  workflow_dispatch:

jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Ping Tracker Health & Sweep
        run: |
          curl -s -f -m 15 https://your-tracker.onrender.com/health || true
          curl -s -f -m 15 -X POST https://your-tracker.onrender.com/internal/sweep \
            -H "Authorization: Bearer ${{ secrets.SWEEP_SECRET }}" || true
```

> [!WARNING]
> **DISABLE THIS WORKFLOW AFTER THE EVENT.**
> Continuous 24/7 pinging consumes ~720-744 instance hours per month, exhausting Render's 750 free instance hours. Disable or delete the workflow when the competition concludes.

---

## Backup & Restore

```bash
# Backup
DIRECT_URL="postgresql://..." ./scripts/backup.sh /path/to/backups

# Restore
gunzip -c /path/to/backups/tracker_20261130_235959.sql.gz | psql "${DIRECT_URL}"
```

### Rehearsal Seed / Teardown

```bash
# Seed 6 test members (direct DB write, no HTTP)
DATABASE_URL=... DIRECT_URL=... npx tsx scripts/seed-rehearsal.ts

# Remove all rehearsal data
DATABASE_URL=... DIRECT_URL=... npx tsx scripts/teardown-rehearsal.ts
```

