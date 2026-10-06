# GAVEL

**GAVEL cross-examines your SOW, your delivery evidence (GitHub/Jira), and your invoices — then issues a verdict on every billed dollar.**

A forensic reconciliation workbench for dev/IT services firms. It reads what was *contracted* (SOW line items, rate cards, milestones, exclusions, change-order policy), what was *actually built* (commits, PRs, ticket state), and what was *invoiced* — then surfaces the gap as an evidence-backed finding a human reviews, approves, and bills. Nothing is auto-billed: **the product proposes, a human asserts.**

- Every finding carries: contract clause + delivery evidence + billing state + assessment + recommended action
- Decomposed 4-pillar confidence scoring (contract / delivery / authorization / billing)
- Deterministic rules first; LLM judgment only for ambiguous calls, always routed to human review
- Immutable audit log on every action; role-based access control (admin / reviewer / viewer)

**Status:** Phase 2 — deployable to real organisations (see `docs/DEPLOYMENT.md`). Multi-tenant with enforced row scoping (every data model carries `tenantId`; the Prisma client layer scopes queries per-request via AsyncLocalStorage and fails closed). Ingestion is dual-path: contracts arrive by paste, file upload, or **direct fetch** (any published https URL, or a file inside a GitHub repo — SSRF-guarded server-side fetch into the same human-review pipeline); delivery + billing evidence arrives via CSV/JSON upload or **saved live connectors** (GitHub, Jira — credentials sealed with AES-256-GCM, synced on demand or on schedule). User provisioning with invite/reset purpose tokens and instant revocation (token epochs). Dual data layer: SQLite for dev, managed PostgreSQL for production (committed migrations, `prisma migrate deploy`).

## Stack

Next.js 16 (App Router) · TypeScript (strict) · Prisma + SQLite (dev) / PostgreSQL (prod) · Zod · JWT cookie auth (httpOnly, SameSite=Strict) · Tailwind + shadcn/ui · `z-ai-web-dev-sdk` (LLM contract extraction) · Vitest · Bun

## Quickstart

Prerequisites: [Bun](https://bun.sh) ≥ 1.2.

```bash
bun install                     # also runs prisma generate (postinstall)
cp .env.example .env            # DATABASE_URL is the only required var
bun run db:push                 # create the SQLite schema
bun run seed:dev                # demo client, contract, 5 findings, 4 alerts
bun run dev                     # http://localhost:3000
```

**Sandbox self-heal:** outside production the server automatically restores the demo accounts (and, on a database with zero clients, the full demo dataset) at startup and on the next login attempt if they go missing — a wiped SQLite file no longer breaks the credentials printed on `/login`. Opt out with `GAVEL_AUTO_SEED_DEMO=false` (e.g. when provisioning real users by hand). Production NEVER auto-seeds.

Demo accounts (created by the seed; the login page hints at them in dev builds only):

| Role | Email | Password |
|------|-------|----------|
| admin | `admin@gavel.demo` | `gavel-admin-demo` |
| reviewer | `reviewer@gavel.demo` | `gavel-reviewer-demo` |
| viewer | `viewer@gavel.demo` | `gavel-viewer-demo` |

## Configuration

All env vars are validated at startup by a Zod schema (`src/lib/env.ts`) — anything not listed there is not a sanctioned var.

| Var | Required | Notes |
|-----|----------|-------|
| `DATABASE_URL` | yes | SQLite in dev (`file:../db/custom.db`); `postgresql://…` (gavel_app role) in production — the Prisma client is generated per protocol at install time (`scripts/generate.ts`) |
| `OWNER_DATABASE_URL` | prod (migrations) | gavel_owner role — bypasses RLS; migrations + system CLI only, never the web process |
| `GAVEL_JWT_SECRET` | prod | HS256 session secret, ≥ 32 chars. Dev uses a loud-warned fallback |
| `GAVEL_CONNECTOR_SECRET` | prod (rec.) | AES-256-GCM key sealing saved connector credentials; falls back to the JWT secret for single-tenant pilots |
| `GAVEL_CONNECTOR_SECRET_PREVIOUS` / `GAVEL_CONNECTOR_KEY_VERSION` | rotation | Zero-downtime credential-key rotation — see `bun run crypto:rotate` |
| `REDIS_URL` | prod (rec.) | BullMQ connector-sync queue; unset → inline sync fallback |
| `GAVEL_SYNC_MODE` | no | `queue` \| `inline` — force a mode regardless of Redis |
| `GAVEL_REQUIRE_AUTH` | no | `true` forces strict production auth regardless of NODE_ENV — use on deploy targets that don't set NODE_ENV reliably |
| `GAVEL_RATE_LIMIT_STORE` | no | `memory` (single process) or `db` (shared, survives restarts — the production default) |
| `GAVEL_AUTO_SEED_DEMO` | no | dev/test only: self-heal that restores missing demo users + demo dataset on an empty DB (default on). `false` disables; never active in production |
| `NEXT_PUBLIC_ENABLE_RESEED` | no | dev/demo convenience for the reseed endpoint + button; keep `false` in prod |
| `NEXT_PUBLIC_APP_URL` | no | canonical public URL |

For production, copy `.env.production.example` and follow `docs/DEPLOYMENT.md`.

## Scripts

| Command | What it does |
|---------|--------------|
| `bun run dev` | dev server on :3000 |
| `bun run build` / `bun run start` | standalone production build / serve |
| `bun run lint` / `bun run typecheck` | ESLint / `tsc --noEmit` (strict) |
| `bun run test` | 276 unit tests (Vitest) |
| `bun run db:push` / `db:generate` | Prisma schema ops (dev provider / regenerate client per DATABASE_URL protocol) |
| `bun run db:push:pg` / `migrate:deploy` | PostgreSQL schema push / apply committed migrations in production |
| `bun run schema:check` | CI gate: committed `schema.postgres.prisma` in sync with the source schema |
| `bun run seed:dev` | wipe + reseed demo data (idempotent, stable ids) |

## Verification

- **Unit**: `bun run test` — formatters, Zod schemas, env parsing, finding state machine, reconciliation engine, rate limiter (+db store), ingestion parser + mappers, connector mapping + credential crypto, tenant context, request principal, provisioning policy, SSRF-guarded source fetch, PG schema sync
- **Live harness**: `scripts/live-audit.ts` — 78 assertions exercising every API route, role guard, finding state machine, idempotent reconcile, and real LLM extraction against a running server
- **Production-fixes harness**: `scripts/verify-production-fixes.sh` — 18 end-to-end checks against a running server: tenant bootstrap via CLI, invite acceptance, cross-tenant isolation (zero cross-tenant rows, cross-tenant ids → 404), role enforcement, instant revocation on disable, live GitHub connector sync + idempotent re-sync, deep health
- **Self-heal harness**: `scripts/verify-selfheal.ts` — wipes users / the whole DB against a running server and proves login restores the documented demo accounts (and demo dataset on an empty DB) without a manual reseed; `scripts/wipe-db.ts` is the standalone wipe helper
- **Ingestion E2E**: `scripts/ingest-demo.sh` — resets the demo DB, uploads the three bundled sample CSVs through `POST /api/ingest`, runs the engine, and asserts that NEW findings were created from the uploaded evidence, then re-uploads everything to prove idempotence (17 assertions)
- **CI** (`.github/workflows/ci.yml`): lint → typecheck → test → PG schema-drift check → migration presence → build on every push/PR to main

## Data ingestion

Three paths, all landing in the same evidence tables (`Ticket` / `CodeActivity` / `Invoice`+`InvoiceLine`) and the same audit-logged commit layer:

1. **CSV/JSON upload** — `POST /api/ingest` (admin, multipart):

| Source type | Writes | Idempotence |
|-------------|--------|-------------|
| `jira-tickets` | `Ticket` | upsert by (project, externalId) — re-upload updates |
| `github-commits` | `CodeActivity` | deduped by ref per project |
| `invoice-lines` | `Invoice` + `InvoiceLine` | existing invoice numbers skipped entirely |

   Behavior: `dryRun=true` validates and previews (first 10 rows + row-level errors) without writing. One bad row never rejects the file — it is skipped and reported. Header matching is lenient (`Issue Key` / `issue_key` / `key`…). Dates accept ISO or `dd/mm/yyyy` (day-first, Indian convention); amounts may carry ₹/$ and thousand separators. Limits: 2 MB, 2,500 rows, 20 uploads / 5 min per user. Bundled samples live in `public/ingest-samples/` and are loadable from the intake wizard ("Load sample data").

2. **Saved live connectors** (intake wizard → Evidence step): store a GitHub owner/repo or Jira host + project with a token (sealed AES-256-GCM at rest, never returned by the API), then `POST /api/connectors/:id/sync` pulls activities/tickets through the same mapper + commit layer. Re-sync is idempotent; `dryRun` supported.

3. **Direct source fetch for contracts** (intake wizard → SOW step → "Link service / URL"): `POST /api/sources/fetch` pulls the SOW text from any published https URL or a GitHub repo file into the editable review textarea — no pasting walls of text. Server-side SSRF guard: https-only, private/reserved IP ranges blocked (literals and DNS-resolved), redirects re-validated per hop, 20 s timeout, 2 MB cap, text-only content types.

## Security posture

- **Tenant isolation (two layers)**: (1) application — every data model carries a required `tenantId`; the Prisma client layer scopes queries per-request via AsyncLocalStorage and fails closed; (2) database — PostgreSQL Row-Level Security on every tenant table (`TO gavel_app` policies on the transaction-local `app.current_tenant_id`), so even a query that bypasses the app layer sees zero cross-tenant rows. The runtime DB role owns nothing; migrations and system CLI run as the owner role via `OWNER_DATABASE_URL`
- **Provisioning & revocation**: invite (72 h) / password-reset (24 h) purpose tokens; disabling a user or bumping their token epoch invalidates live sessions on the next request; last-admin + self-lockout guards
- httpOnly + `SameSite=Strict` + Secure-in-prod JWT cookie; middleware stamps verified identity into request headers (client-supplied actor headers are ignored)
- Login/ingest/sync brute-force protection: fixed-window rate limit per IP and per identity, 429 + `Retry-After`; store is db-backed (shared across instances) in production
- CSRF surface closed by architecture (SameSite=Strict + JSON-only bodies + no CORS) — rationale documented in `src/lib/auth-cookie.ts`
- Connector credentials sealed with AES-256-GCM (scrypt-derived key) before storage; write-only — the API never returns them; versioned envelopes (`enc:k<N>:`) with a zero-downtime `crypto:rotate` CLI
- Server-side fetching behind a DNS-pinned SSRF guard (resolve once → validate every record → dial the validated IP with original Host/SNI — no TOCTOU rebinding window) across source fetch AND connector APIs
- Async connector syncs (BullMQ + Redis) with 5-attempt exponential backoff; durable, RLS-protected SyncJob rows are the progress source of truth (SSE + polling)
- Immutable audit log on every mutation, with actor + request id
- Caddy edge config: security headers, 1 MB body limit, no CORS

## License

Proprietary. Private repository, not for distribution.
