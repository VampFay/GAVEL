# GAVEL

**GAVEL cross-examines your SOW, your delivery evidence (GitHub/Jira), and your invoices — then issues a verdict on every billed dollar.**

A forensic reconciliation workbench for dev/IT services firms. It reads what was *contracted* (SOW line items, rate cards, milestones, exclusions, change-order policy), what was *actually built* (commits, PRs, ticket state), and what was *invoiced* — then surfaces the gap as an evidence-backed finding a human reviews, approves, and bills. Nothing is auto-billed: **the product proposes, a human asserts.**

- Every finding carries: contract clause + delivery evidence + billing state + assessment + recommended action
- Decomposed 4-pillar confidence scoring (contract / delivery / authorization / billing)
- Deterministic rules first; LLM judgment only for ambiguous calls, always routed to human review
- Immutable audit log on every action; role-based access control (admin / reviewer / viewer)

**Status:** Phase 0→1. Contracts are pasted in and LLM-extracted; delivery + billing evidence now arrives via **CSV/JSON upload** (Jira/GitHub/accounting exports — see *Data ingestion* below); read-only OAuth connectors (GitHub App, Atlassian, Linear, QuickBooks) are Phase 2 and will feed the same pipeline. Postgres migration (row-level tenant isolation, embedding-based matching) pending. Single-instance deployment — cross-tenant authorization does not exist yet; every GET route returns data to any authenticated (in dev: even anonymous) caller. Do not share an instance between customers until tenancy lands.

## Stack

Next.js 16 (App Router) · TypeScript (strict) · Prisma + SQLite · Zod · JWT cookie auth (httpOnly, SameSite=Strict) · Tailwind + shadcn/ui · `z-ai-web-dev-sdk` (LLM contract extraction) · Vitest · Bun

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
| `DATABASE_URL` | yes | SQLite in dev (`file:../db/custom.db`); Postgres pending |
| `GAVEL_JWT_SECRET` | prod | HS256 session secret, ≥ 32 chars. Dev uses a loud-warned fallback |
| `GAVEL_REQUIRE_AUTH` | no | `true` forces strict production auth regardless of NODE_ENV — use on deploy targets that don't set NODE_ENV reliably |
| `GAVEL_AUTO_SEED_DEMO` | no | dev/test only: self-heal that restores missing demo users + demo dataset on an empty DB (default on). `false` disables; never active in production |
| `NEXT_PUBLIC_ENABLE_RESEED` | no | dev convenience for the reseed endpoint; keep `false` in prod |
| `NEXT_PUBLIC_APP_URL` | no | canonical public URL |

## Scripts

| Command | What it does |
|---------|--------------|
| `bun run dev` | dev server on :3000 |
| `bun run build` / `bun run start` | standalone production build / serve |
| `bun run lint` / `bun run typecheck` | ESLint / `tsc --noEmit` (strict) |
| `bun run test` | 196 unit tests (Vitest) |
| `bun run db:push` / `db:generate` / `db:reset` | Prisma schema ops |
| `bun run seed:dev` | wipe + reseed demo data (idempotent) |

## Verification

- **Unit**: `bun run test` — formatters, Zod schemas, env parsing, finding state machine, reconciliation engine, rate limiter, ingestion parser + mappers, bootstrap self-heal gates + login-page credential drift guard
- **Live harness**: `scripts/live-audit.ts` — 78 assertions exercising every API route, role guard, finding state machine, idempotent reconcile, and real LLM extraction against a running server
- **Self-heal harness**: `scripts/verify-selfheal.ts` — wipes users / the whole DB against a running server and proves login restores the documented demo accounts (and demo dataset on an empty DB) without a manual reseed; `scripts/wipe-db.ts` is the standalone wipe helper
- **Ingestion E2E**: `scripts/ingest-demo.sh` — resets the demo DB, uploads the three bundled sample CSVs through `POST /api/ingest`, runs the engine, and asserts that NEW findings were created from the uploaded evidence, then re-uploads everything to prove idempotence (17 assertions)
- **CI** (`.github/workflows/ci.yml`): lint → typecheck → test → build on every push/PR to main

## Data ingestion

`POST /api/ingest` (admin, multipart) accepts CSV or JSON exports and writes them into the engine's evidence tables — the same `Ticket` / `CodeActivity` / `Invoice`+`InvoiceLine` rows the reconcile route reads:

| Source type | Writes | Idempotence |
|-------------|--------|-------------|
| `jira-tickets` | `Ticket` | upsert by (project, externalId) — re-upload updates |
| `github-commits` | `CodeActivity` | deduped by ref per project |
| `invoice-lines` | `Invoice` + `InvoiceLine` | existing invoice numbers skipped entirely |

Behavior: `dryRun=true` validates and previews (first 10 rows + row-level errors) without writing. One bad row never rejects the file — it is skipped and reported. Header matching is lenient (`Issue Key` / `issue_key` / `key`…). Dates accept ISO or `dd/mm/yyyy` (day-first, Indian convention); amounts may carry ₹/$ and thousand separators. Limits: 2 MB, 2,500 rows, 20 uploads / 5 min per user. Every commit is audit-logged. Bundled samples live in `public/ingest-samples/` and are loadable from the intake wizard ("Load sample data").

## Security posture

- httpOnly + `SameSite=Strict` + Secure-in-prod JWT cookie; middleware stamps verified identity into request headers (client-supplied actor headers are ignored)
- Login brute-force protection: sliding-window rate limit per IP (10 fails / 5 min) and per email (10 fails / 15 min); 429 + `Retry-After`; only failures consume budget
- Fail-safe auth: `GAVEL_REQUIRE_AUTH=true` forces 401 on all unauthenticated access regardless of NODE_ENV
- CSRF surface closed by architecture (SameSite=Strict + JSON-only bodies + no CORS) — rationale documented in `src/lib/auth-cookie.ts`
- Immutable audit log on every mutation, with actor + request id
- Caddy edge config: security headers, 1 MB body limit, no CORS

## License

Proprietary. Private repository, not for distribution.
