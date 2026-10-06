import { PrismaClient } from '@prisma/client'

// GAVEL — system/owner database client (WP 1.1).
//
// The runtime server connects as gavel_app, which on PostgreSQL is fully
// subject to the RLS policies: without app.current_tenant_id it sees ZERO
// tenant-table rows. That is the intended fail-closed posture — but a few
// SYSTEM surfaces legitimately need cross-tenant or table-agnostic access:
//
//   * /api/health?deep=1 — platform-wide diagnostics (counts, migrations)
//   * scripts/seed.ts, create-tenant.ts — provisioning, run from the CLI
//   * crypto:rotate (WP 1.4) — re-seals every tenant's connector rows
//
// Those paths use THIS client, which connects with OWNER_DATABASE_URL
// (table owner ⇒ bypasses RLS — the deliberate trusted path). On SQLite
// (dev/test) or when OWNER_DATABASE_URL is absent, it is a plain
// unscoped PrismaClient on DATABASE_URL: correct for CLI entry points
// (no request tenant context exists there, and SQLite has no RLS layer).
//
// OWNER_DATABASE_URL must point at the SAME database as DATABASE_URL with
// the gavel_owner role. It must NEVER be provided to the web server
// process in production — only to CLI/diagnostic entry points. Enforced
// below: when NODE_ENV=production the URL is ignored unless the explicit
// GAVEL_ALLOW_SYSTEM_DB=true opt-in is set (used by the health route).

const globalForSystemPrisma = globalThis as unknown as {
  gavelSystemPrisma: PrismaClient | undefined
}

function ownerUrl(): string | null {
  const url = process.env.OWNER_DATABASE_URL
  if (!url || !url.startsWith('postgres')) return null
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.GAVEL_ALLOW_SYSTEM_DB !== 'true'
  ) {
    // Fail-safe: a production web process must never silently gain a
    // bypass-RLS connection because someone left the env var exported.
    console.warn(
      '⚠️  GAVEL: OWNER_DATABASE_URL is set in production without ' +
      'GAVEL_ALLOW_SYSTEM_DB=true — ignoring it (system client stays on ' +
      'the RLS-constrained app connection).'
    )
    return null
  }
  return url
}

function buildSystemDb(): PrismaClient {
  const url = ownerUrl()
  if (url) {
    return new PrismaClient({ datasources: { db: { url } }, log: ['error', 'warn'] })
  }
  return new PrismaClient({ log: ['error', 'warn'] })
}

export const systemDb: PrismaClient =
  globalForSystemPrisma.gavelSystemPrisma ?? buildSystemDb()

if (process.env.NODE_ENV !== 'production') {
  globalForSystemPrisma.gavelSystemPrisma = systemDb
}
