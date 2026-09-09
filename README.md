# GAVEL

**GAVEL cross-examines your SOW, your delivery evidence (GitHub/Jira), and your invoices — then issues a verdict on every billed dollar.**

A forensic reconciliation workbench for dev/IT services firms. It reads what was *contracted* (SOW line items, rate cards, milestones, exclusions, change-order policy), what was *actually built* (commits, PRs, ticket state), and what was *invoiced* — then surfaces the gap as an evidence-backed finding a human reviews, approves, and bills. Nothing is auto-billed: **the product proposes, a human asserts.**

- Every finding carries: contract clause + delivery evidence + billing state + assessment + recommended action
- Decomposed 4-pillar confidence scoring (contract / delivery / authorization / billing)
- Deterministic rules first; LLM judgment only for ambiguous calls, always routed to human review
- Immutable audit log on every action; role-based access control (admin / reviewer / viewer)

**Status:** Phase 0. Contracts are pasted in and delivery records ingested directly; read-only OAuth connectors (GitHub App, Atlassian, Linear) are Phase 2. Postgres migration (row-level tenant isolation, embedding-based matching) pending. Single-instance deployment.

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
| `NEXT_PUBLIC_ENABLE_RESEED` | no | dev convenience for the reseed endpoint; keep `false` in prod |
| `NEXT_PUBLIC_APP_URL` | no | canonical public URL |

## Scripts

| Command | What it does |
|---------|--------------|
| `bun run dev` | dev server on :3000 |
| `bun run build` / `bun run start` | standalone production build / serve |
| `bun run lint` / `bun run typecheck` | ESLint / `tsc --noEmit` (strict) |
| `bun run test` | 141 unit tests (Vitest) |
| `bun run db:push` / `db:generate` / `db:reset` | Prisma schema ops |
| `bun run seed:dev` | wipe + reseed demo data (idempotent) |

## Verification

- **Unit**: `bun run test` — formatters, Zod schemas, env parsing, finding state machine, reconciliation engine, rate limiter
- **Live harness**: `scripts/live-audit.ts` — 78 assertions exercising every API route, role guard, finding state machine, idempotent reconcile, and real LLM extraction against a running server
- **CI** (`.github/workflows/ci.yml`): lint → typecheck → test → build on every push/PR to main

## Security posture

- httpOnly + `SameSite=Strict` + Secure-in-prod JWT cookie; middleware stamps verified identity into request headers (client-supplied actor headers are ignored)
- Login brute-force protection: sliding-window rate limit per IP (10 fails / 5 min) and per email (10 fails / 15 min); 429 + `Retry-After`; only failures consume budget
- Fail-safe auth: `GAVEL_REQUIRE_AUTH=true` forces 401 on all unauthenticated access regardless of NODE_ENV
- CSRF surface closed by architecture (SameSite=Strict + JSON-only bodies + no CORS) — rationale documented in `src/lib/auth-cookie.ts`
- Immutable audit log on every mutation, with actor + request id
- Caddy edge config: security headers, 1 MB body limit, no CORS

## License

Proprietary. Private repository, not for distribution.
