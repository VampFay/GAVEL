# GAVEL — Production Deployment Runbook

This is the operator's manual for running GAVEL with real client data. It
covers the five blockers the production-readiness plan identified and how
the current code resolves each:

| Blocker | Resolution | Where |
|---|---|---|
| SQLite single-instance | Dual-provider data layer: canonical schema (sqlite, dev/test) + committed Postgres schema + real migrations | `prisma/schema.postgres.prisma`, `prisma/migrations/`, `scripts/sync-pg-schema.ts` |
| No tenant isolation | `tenantId` on every data row + Prisma client extension that hard-scopes reads/writes per request + fail-closed semantics | `src/lib/db.ts`, `src/lib/tenant-context.ts`, `src/lib/api.ts` |
| No user provisioning | Admin user CRUD, invite/reset links, roles, instant session revocation (token epochs) | `src/app/api/admin/users/**`, `src/lib/provisioning.ts`, Team view |
| Demo-grade ingestion | Live GitHub + Jira connectors with sealed credentials, feeding the same ingestion pipeline as CSV | `src/lib/connectors/**`, `src/app/api/connectors/**` |
| Zero production ops | Migrations, deep health probe, backup/restore with retention, CI drift guards, this runbook | `scripts/backup.sh`, `scripts/restore.sh`, `.github/workflows/ci.yml` |

---

## 1. Prerequisites

- **Node 20+ or Bun 1.2+**
- **PostgreSQL 16** (14+ works; 16 is what dev parity and CI test
  against) — managed strongly recommended (Neon, Supabase, RDS).
  Take note of the connection string and whether TLS is required
  (`sslmode=require` — the default on managed providers).
- **Redis 7** — for the async connector-sync queue (WP 1.2). Without it
  the sync route falls back to inline execution; with it, run the worker
  process (`bun run worker`) alongside the web process.
- **A TLS-terminating proxy** — Caddy (a `Caddyfile` is in the repo) or
  your platform's edge. GAVEL cookies are `Secure`-flagged behind HTTPS.

Local development uses the same stack via `docker compose up -d`
(postgres:16-alpine + redis:7-alpine, roles provisioned on first boot),
or `bun run db:embedded` for a no-Docker embedded PostgreSQL 16.

## 2. Environment

Copy `.env.production.example` and fill in at minimum:

```
DATABASE_URL=postgresql://gavel_app:…@host:5432/gavel?sslmode=require
OWNER_DATABASE_URL=postgresql://gavel_owner:…@host:5432/gavel?sslmode=require
GAVEL_JWT_SECRET=<openssl rand -hex 32>
GAVEL_CONNECTOR_SECRET=<openssl rand -hex 32>   # different from the JWT secret
REDIS_URL=redis://…
NEXT_PUBLIC_APP_URL=https://gavel.yourdomain.com
NODE_ENV=production
```

The app validates this at startup (`src/lib/env.ts`) and fails loudly on a
missing/short JWT secret. The rate limiter defaults to the **db store** in
production (shared across instances, survives restarts).

### Roles (database-level tenant isolation — WP 1.1)

Migration `0002_rls_tenant_isolation` enables Row-Level Security on every
tenant-data table with `TO gavel_app` policies keyed on the transaction-local
`app.current_tenant_id` (set by `src/lib/db.ts` on every scoped operation).
The runtime role (`gavel_app`, `DATABASE_URL`) owns nothing and is fully
RLS-constrained: a query that forgets its tenant context sees ZERO rows.
The owner role (`gavel_owner`, `OWNER_DATABASE_URL`) runs migrations and
system CLI tools (create-tenant, seed, crypto:rotate) — never the web
process (enforced: OWNER_DATABASE_URL is ignored in production unless
GAVEL_ALLOW_SYSTEM_DB=true, used only by `health?deep=1`).

Provision on managed PostgreSQL (mirrors `scripts/pg/init-roles.sql`):

```sql
CREATE ROLE gavel_owner LOGIN PASSWORD '…';
CREATE ROLE gavel_app   LOGIN PASSWORD '…';
GRANT CONNECT ON DATABASE gavel TO gavel_owner, gavel_app;
GRANT USAGE, CREATE ON SCHEMA public TO gavel_owner;
GRANT USAGE ON SCHEMA public TO gavel_app;
GRANT CREATE ON DATABASE gavel TO gavel_owner;  -- 0001 issues CREATE SCHEMA IF NOT EXISTS
```

## 3. First deploy

```bash
bun install                      # postinstall generates the PG-bound client
                                 # (DATABASE_URL protocol decides — scripts/generate.ts)
bun run migrate:deploy:owner    # applies prisma/migrations/* as gavel_owner
                                 # (needs OWNER_DATABASE_URL)
bun run build                   # standalone output in .next/standalone
bun run start                   # web process (gavel_app connection)
bun run worker                  # connector-sync worker (same env + REDIS_URL)
```

Then bootstrap the first tenant (tenants are CLI-only by design — bringing
an organisation on board is a billing step, not a UI click):

```bash
bun scripts/create-tenant.ts "Acme Consulting" acme \
  --admin "founder@acme.com" --admin-name "Priya Sharma" \
  --base-url https://gavel.yourdomain.com
```

The command prints a **one-time invite link** (72h). Deliver it over a
secure channel; the admin sets their password at that link and everything
else (inviting their team, managing roles) happens in the app's Team view.

## 4. Operating

### Health & monitoring

- `GET /api/health` — liveness (DB ping + version). For load balancers.
- `GET /api/health?deep=1` — readiness/diagnostics: DB latency, provider,
  object counts, applied-migration count, uptime, memory. Point your
  external monitor here; alert on `ok:false` or rising `dbLatencyMs`.

### Backups

```bash
bash scripts/backup.sh daily    # 03:15 cron — keeps newest 7
bash scripts/backup.sh weekly   # Sunday cron — keeps newest 4
```

Test restores quarterly: `bash scripts/restore.sh <file> --force` against
a staging database. An untested backup is a hope, not a plan.

### Migrations on upgrade

1. Run `bun run migrate:deploy` against the production database BEFORE
   deploying the new code (migrations are additive-first; the init
   migration is the baseline).
2. Rolling back code is safe as long as the migration wasn't destructive —
   read the new `migration.sql` before applying.

### Multi-tenant onboarding (repeat per customer)

`create-tenant.ts` → invite link → admin activates → admin invites their
team with roles. Cross-tenant reads are impossible by construction (the
Prisma extension masks foreign rows as 404s) — but still keep one tenant
per customer organisation, and never share users across tenants.

### Secrets rotation

- `GAVEL_JWT_SECRET` — rotating logs out every session. Users just sign
  in again.
- `GAVEL_CONNECTOR_SECRET` — rotating invalidates sealed connector
  credentials; each project's GitHub/Jira config must be re-entered
  (config survives, only the sealed token needs re-saving).

## 5. What is deliberately NOT solved here

- **Email delivery** — invite/reset links are returned to the admin to
  deliver over their own channel. Wire SMTP + a mailer when product
  velocity demands it; the token machinery needs no changes.
- **SSO (Google/Okta)** — the auth layer is a hand-rolled, auditable
  credentials flow. When an enterprise customer demands SAML/OIDC, add
  `next-auth` and replace `signToken`/`verifyToken`.
- **Horizontal autoscaling** — supported (db-backed rate limits, no
  in-process state that matters), but untested beyond a single node +
  Postgres. Load-test before scaling out.
- **PG-level audit-log immutability** — the application layer blocks
  mutations (and `NODE_ENV=production` enforces it); add DB triggers /
  `REVOKE UPDATE` on `AuditLog` for defense-in-depth when a compliance
  auditor asks.

## 6. Regenerating the Postgres schema / migration

When `prisma/schema.prisma` changes:

```bash
bun run schema:sync               # regenerate schema.postgres.prisma
bun run schema:check              # verify (this is what CI runs)
```

For a **model change** (not just comments), also add an incremental
migration: diff the previous PG schema against the new one and commit the
SQL as `prisma/migrations/NNNN_name/migration.sql`:

```bash
git stash                            # park the new schema
bun run schema:sync                  # PG schema = old state
cp prisma/schema.postgres.prisma /tmp/old-pg.prisma
git stash pop
bun run schema:sync                  # PG schema = new state
DATABASE_URL="postgresql://u:p@l/x" bunx prisma migrate diff \
  --from-schema-datamodel /tmp/old-pg.prisma \
  --to-schema-datamodel prisma/schema.postgres.prisma --script \
  > prisma/migrations/0002_your_change/migration.sql
```

## 7. Quick reference

| Task | Command |
|---|---|
| Apply migrations | `bun run migrate:deploy` |
| Push schema to a fresh PG (no migrations) | `bun run db:push:pg` |
| Check schema drift | `bun run schema:check` |
| Create tenant + admin | `bun scripts/create-tenant.ts …` |
| Backup / restore | `bash scripts/backup.sh` / `restore.sh` |
| Deep health | `curl -s https://your-host/api/health?deep=1` |

---

## Connector-credential key rotation (WP 1.4)

Stored connector credentials are sealed with AES-256-GCM under a key derived
from `GAVEL_CONNECTOR_SECRET`. Rotation is zero-downtime:

```bash
# 1. New secret + demoted old secret + version bump, then deploy.
#    Mixed-version fleets keep reading every envelope (self-describing
#    versions: legacy enc:v1: and versioned enc:k<N>:).
export GAVEL_CONNECTOR_SECRET=$(openssl rand -hex 32)     # NEW
export GAVEL_CONNECTOR_SECRET_PREVIOUS=<the-old-secret>
export GAVEL_CONNECTOR_KEY_VERSION=2

# 2. Re-seal every stored credential (idempotent, --verify round-trips).
bun run crypto:rotate            # add --dry-run to preview

# 3. Unset GAVEL_CONNECTOR_SECRET_PREVIOUS. Rotation complete.
```

The CLI walks every tenant's connectors through the owner connection,
reports per-generation counts, and lists any rows it could not open (those
need their credentials re-entered — e.g. sealed under a long-lost secret).

## Async connector sync (WP 1.2)

With `REDIS_URL` set, `POST /api/connectors/:id/sync` enqueues a BullMQ job
and returns `202 { jobId }` — the worker (`bun run worker`) executes the
pull + commit with 5 attempts and exponential backoff (2s→16s). Progress:

- **SSE**: `GET /api/connectors/:id/progress?jobId=…` — `state` events with
  status/attempts/stats, `done` on termination, 15 s heartbeats, 10 min cap.
- **Polling**: `GET /api/connectors/:id/jobs?limit=10` — recent jobs.

The durable `SyncJob` row (tenant-scoped + RLS-protected like all tenant
data) is the single source of truth for both. Without `REDIS_URL` the sync
route executes inline — the identical code path (`src/lib/jobs/sync-core.ts`)
without the queue.

## SSRF posture (WP 1.3)

All server-side URL fetching — published-document pulls
(`/api/sources/fetch`), GitHub API calls, and Jira (user-controlled hosts) —
goes through the DNS-pinned client (`src/lib/net/pinned-fetch.ts`): resolve
once, validate EVERY record against the private/reserved CIDR set, dial the
validated IP directly with the original Host header and TLS SNI. There is no
second resolution anywhere on the request path, which closes the classic
TOCTOU DNS-rebinding window. Redirects are followed manually, one pinned
hop at a time.
