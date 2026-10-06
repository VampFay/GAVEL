import { AsyncLocalStorage } from 'node:async_hooks'
import { PrismaClient, type AuditLog } from '@prisma/client'

import { getTenantContext, TenantContextError } from './tenant-context'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Gate query logging behind NODE_ENV === 'development'. In production we
 * only log errors and warnings — otherwise stdout floods with parameter
 * bindings (PII + perf risk).
 */
const logLevel: ('query' | 'error' | 'warn')[] =
  process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error', 'warn']

// ─────────────────────────────────────────────────────────────────────────────
// Provider detection (WP 1.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * True when the runtime DATABASE_URL targets PostgreSQL — i.e. when the
 * database-level RLS layer (migration 0002) exists and every scoped
 * operation must carry the transaction-local app.current_tenant_id.
 * SQLite (dev/test) keeps the single-layer application scoping.
 */
function isPostgresRuntime(): boolean {
  const url = process.env.DATABASE_URL ?? ''
  return url.startsWith('postgres://') || url.startsWith('postgresql://')
}

// ─────────────────────────────────────────────────────────────────────────────
// Tenant scoping (production blocker #2 + WP 1.1 RLS integration)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Models that carry client data and therefore a required `tenantId`.
 * MUST stay in lockstep with prisma/schema.prisma — every model listed
 * here has a tenantId column; every model with a tenantId column is
 * listed here. User/Tenant are deliberately absent: user lookup at login
 * must work before any tenant is known, and tenant management is a
 * platform-level operation guarded by role checks in the routes.
 *
 * NOTE: these are the model names as Prisma reports them in extension
 * params — the PASCALCASE schema names ("Client", "FindingEvidence").
 * tests/unit/db-scoping.test.ts asserts schema ↔ set ↔ RLS-migration
 * parity, so a new tenant model fails CI until all three agree.
 */
const SCOPED_MODELS = new Set<string>([
  'Client',
  'Contract',
  'ChangeOrder',
  'LineItem',
  'Milestone',
  'Exclusion',
  'Project',
  'Ticket',
  'CodeActivity',
  'TimeEntry',
  'Invoice',
  'InvoiceLine',
  'Payment',
  'Finding',
  'FindingEvidence',
  'MonitoredProject',
  'WeeklyDriftSnapshot',
  'Alert',
  'ConnectorSource',
  'SyncJob',
  'AuditLog',
])

/** Read operations whose `where` can be merged with a tenant filter. */
const WHERE_MERGE_OPS = new Set<string>([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
])

/** Unique-keyed reads — tenant-checked AFTER the fetch (see below). */
const UNIQUE_READ_OPS = new Set<string>(['findUnique', 'findUniqueOrThrow'])

type AnyArgs = Record<string, any>

/**
 * Post-fetch tenant verification for unique-keyed reads: if the row exists
 * but belongs to another tenant, behave exactly as "not found" — null for
 * findUnique, a P2025-shaped error for findUniqueOrThrow (withErrorHandler
 * maps it to 404). The row never crosses the tenant boundary.
 *
 * Projection guard (latent-bug fix, surfaced by WP 1.2's jobs route): a
 * findUnique with `select: { id: true }` returns a row WITHOUT a tenantId
 * field — the mask must not misread that as a cross-tenant row. The fix:
 * when a projection exists, tenantId is force-added to it so the check
 * always has the evidence it needs. The extra field on the result is
 * inert (callers select narrow fields for payloads, not for secrecy).
 */
function ensureTenantIdSelected(a: AnyArgs): void {
  if (a.select && typeof a.select === 'object' && !Array.isArray(a.select)) {
    if (a.select.tenantId === undefined) a.select = { ...a.select, tenantId: true }
  }
}

function maskCrossTenantResult(operation: string, result: unknown, tenantId: string): unknown {
  if (result === null || result === undefined) return result
  const row = result as { tenantId?: string | null }
  if (row.tenantId === tenantId) return result
  if (operation === 'findUniqueOrThrow') {
    throw Object.assign(new Error('record not found'), { code: 'P2025' })
  }
  return null
}

/**
 * Apply the application-layer tenant filter IN PLACE (layer 1 of defense):
 * where-merge for list/count ops, tenant stamping for creates/upserts.
 * Returns the args object to hand to the executor. Pure argument surgery —
 * safe to run twice, and shared by both execution paths below.
 */
function applyTenantFilter(operation: string, a: AnyArgs, tenantId: string): AnyArgs {
  if (UNIQUE_READ_OPS.has(operation)) {
    ensureTenantIdSelected(a)
    return a
  }
  if (WHERE_MERGE_OPS.has(operation)) {
    a.where = { AND: [{ tenantId }, a.where ?? {}] }
    return a
  }
  if (operation === 'create' || operation === 'createManyAndReturn') {
    if (a.data && typeof a.data === 'object' && !Array.isArray(a.data)) {
      if (a.data.tenantId === undefined) a.data.tenantId = tenantId
    }
    return a
  }
  if (operation === 'createMany') {
    if (Array.isArray(a.data)) {
      for (const row of a.data) {
        if (row && row.tenantId === undefined) row.tenantId = tenantId
      }
    } else if (a.data && typeof a.data === 'object' && a.data.tenantId === undefined) {
      a.data.tenantId = tenantId
    }
    return a
  }
  if (operation === 'upsert') {
    if (a.create && a.create.tenantId === undefined) a.create.tenantId = tenantId
    return a
  }
  // update/delete with unique where, raw pass-through: routes only ever
  // pass ids that came out of a scoped read, AND on PostgreSQL the RLS
  // layer additionally zeroes cross-tenant writes at the database itself.
  return a
}

/**
 * RLS transaction tracking (layer 2 wiring).
 *
 * When db.$transaction(cb) runs on a scoped client, the override below
 * sets the GUC as the transaction's first statement and establishes this
 * ALS flag around the user callback — so model operations issued on the
 * tx delegate know they are already inside a GUC-carrying transaction and
 * must NOT open a nested one (Prisma forbids nested interactive
 * transactions). Plain JS async chain: the flag survives from our wrapper
 * into user route code, no engine boundary is crossed.
 */
const rlsTx = new AsyncLocalStorage<{ tenantId: string }>()

/**
 * Interactive-transaction options for the per-operation RLS wrapper.
 * Generous timeout: connector sync / ingest commits run multi-statement
 * work; the Prisma default (5 s) is too tight for them.
 */
const RLS_TX_OPTIONS = { timeout: 60_000, maxWait: 5_000 } as const

/**
 * WHY A PROXY INSTEAD OF ONE GLOBAL EXTENSION:
 *
 * Prisma invokes $allOperations callbacks OUTSIDE the caller's
 * AsyncLocalStorage context (verified empirically under BOTH Bun and
 * Node — the engine's native boundary drops the async context). A single
 * globally-extended client therefore cannot see the per-request tenant.
 *
 * The proxy reads the tenant at PROPERTY-ACCESS time — i.e. in route code
 * (`db.client.findMany…`), where ALS works — and returns a per-tenant
 * memoized client whose extension closes over that tenantId. Same DX
 * (`import { db }` everywhere), correct semantics.
 *
 * Context rules enforced at access time:
 *   - no context (scripts, bootstrap, CLI)  → unscoped base client
 *   - context with unscoped: true           → unscoped base client
 *   - context with tenantId: string         → that tenant's scoped client
 *   - context with tenantId: null           → TenantContextError (FAIL
 *     CLOSED: a tenantless authenticated user must never touch data)
 *
 * PostgreSQL adds layer 2 on top (see buildTenantScopedClient): every
 * scoped operation runs inside a transaction whose first statement is
 * `SELECT set_config('app.current_tenant_id', …, true)` (SET LOCAL
 * semantics — scoped to the transaction, safe with pooled connections).
 * The RLS policies in migration 0002 then enforce isolation AT THE
 * DATABASE even if the where-injection above were bypassed entirely.
 */
function buildTenantScopedClient(base: PrismaClient, tenantId: string) {
  const useRls = isPostgresRuntime()

  return base.$extends({
    name: 'tenantScoping',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !SCOPED_MODELS.has(model)) {
            return query(args)
          }
          const a = applyTenantFilter(operation, args as AnyArgs, tenantId)

          // PostgreSQL: single-keyed reads need masking AFTER fetch even
          // with RLS (findUnique by a non-tenant-id unique key would
          // otherwise return the row if… no — with RLS it cannot. But the
          // masking also produces the correct P2025-vs-null semantics that
          // withErrorHandler maps to 404; RLS returns null either way.)
          const finish = (result: unknown) => {
            if (UNIQUE_READ_OPS.has(operation)) {
              return maskCrossTenantResult(operation, result, tenantId)
            }
            return result
          }

          if (!useRls) {
            // SQLite dev/test: application-layer scoping only.
            return finish(await query(a))
          }

          // Already inside a GUC-carrying transaction (db.$transaction
          // override below) — executing directly keeps the transaction
          // intact; opening another one would nest and fail.
          if (rlsTx.getStore()) {
            return finish(await query(a))
          }

          // Standalone operation: open a transaction, set the tenant GUC
          // as its first statement, then run the operation on that
          // transaction's connection. We deliberately execute on the tx
          // delegate (not `query`) so the statement shares the
          // transaction — this is what makes the GUC apply to it.
          //
          // (Route-level db.$transaction(cb) calls do NOT re-enter this
          // branch: the proxy-level wrapper below sets the GUC once at the
          // start of the transaction and flags rlsTx, so operations issued
          // on the tx delegate take the already-inside-tx path above.)
          return finish(
            await base.$transaction(
              async tx => {
                await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
                return (tx as unknown as Record<string, Record<string, (x: AnyArgs) => Promise<unknown>>>)
                  [model]![operation]!(a)
              },
              RLS_TX_OPTIONS as unknown as undefined,
            ),
          )
        },
      },
    },
    // NOTE: $transaction is NOT overridden via the client extension —
    // empirically (Prisma 6.19) a client-component $transaction override
    // corrupts the return path (the wrapper comes back uncalled). The
    // GUC injection for route-level transactions happens one level up,
    // in the db proxy below.
  })
}

/**
 * Immutability guard for the AuditLog table.
 *
 * In production, all update/delete operations on `auditLog` are blocked
 * at the Prisma-client layer. This is the documented trust anchor
 * (§10 of the product plan) — once written, an audit entry must never
 * change.
 *
 * In development, mutations are allowed so the seed script can clean
 * up before re-inserting.
 */
function withImmutabilityGuard(client: PrismaClient) {
  if (process.env.NODE_ENV !== 'production') return client
  return client.$extends({
    name: 'auditLogImmutable',
    query: {
      auditLog: {
        update: () => {
          throw new Error('AuditLog is immutable — update() is not allowed in production')
        },
        updateMany: () => {
          throw new Error('AuditLog is immutable — updateMany() is not allowed in production')
        },
        delete: () => {
          throw new Error('AuditLog is immutable — delete() is not allowed in production')
        },
        deleteMany: () => {
          throw new Error('AuditLog is immutable — deleteMany() is not allowed in production')
        },
        upsert: () => {
          throw new Error('AuditLog is immutable — upsert() is not allowed in production')
        },
      },
    },
  })
}

const baseClient = globalForPrisma.prisma ?? new PrismaClient({ log: logLevel })
const guarded = withImmutabilityGuard(baseClient) as PrismaClient

// ── Per-tenant memoized clients ─────────────────────────────────────────────
// Bounded by tenant count; $extends is cheap but not free, so cache.

const scopedClients = new Map<string, ReturnType<typeof buildTenantScopedClient>>()

function scopedClientFor(tenantId: string): ReturnType<typeof buildTenantScopedClient> {
  let c = scopedClients.get(tenantId)
  if (!c) {
    c = buildTenantScopedClient(guarded, tenantId)
    scopedClients.set(tenantId, c)
  }
  return c
}

// ── The proxy ────────────────────────────────────────────────────────────────

const dbProxy = new Proxy({} as PrismaClient, {
  get(_target, prop, _receiver) {
    if (typeof prop !== 'string') return undefined
    const ctx = getTenantContext()

    // Route-level interactive transactions on a scoped client (PostgreSQL):
    // inject the tenant GUC as the transaction's FIRST statement and mark
    // rlsTx so operations issued on the tx delegate skip the per-op wrap.
    // Array-form transactions pass through untouched — they are used
    // exclusively on platform tables (User), which carry no RLS policies;
    // tests/unit/rls-integration.test.ts asserts that constraint.
    if (prop === '$transaction' && isPostgresRuntime() && ctx && !ctx.unscoped && ctx.tenantId) {
      const scoped = scopedClientFor(ctx.tenantId)
      // Capture the narrowed tenant id — TS cannot keep the truthiness
      // narrowing through the closure below.
      const tenantId = ctx.tenantId
      return (arg: unknown, opts: unknown) => {
        if (typeof arg !== 'function') {
          return (scoped as unknown as { $transaction: (a: unknown, o: unknown) => unknown }).$transaction(arg, opts)
        }
        const callback = arg as (tx: PrismaClient) => unknown
        return (scoped as unknown as {
          $transaction: (cb: (tx: PrismaClient) => Promise<unknown>, o?: unknown) => Promise<unknown>
        }).$transaction(
          async tx => {
            await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
            return rlsTx.run({ tenantId }, () => callback(tx))
          },
          opts,
        )
      }
    }

    if (!ctx || ctx.unscoped) {
      // Process-level code: scripts, bootstrap, CLI. Unscoped by design.
      // NOTE on PostgreSQL: this path connects as gavel_app WITHOUT a
      // tenant GUC, so RLS hides every tenant-table row (fail-closed).
      // System maintenance that must read/write tenant tables uses the
      // OWNER connection from src/lib/db-system.ts instead.
      return Reflect.get(guarded as object, prop)
    }
    if (ctx.tenantId === null) {
      // A request-context WITHOUT a tenant — fail closed.
      throw new TenantContextError(
        'tenant context is required for this query but none was established ' +
        '(tenantless user or anonymous request) — refusing to run unscoped'
      )
    }
    return Reflect.get(scopedClientFor(ctx.tenantId) as object, prop)
  },
})

// Cast: the proxy forwards everything; existing `db` imports keep working.
export const db: PrismaClient = dbProxy

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = baseClient

export { SCOPED_MODELS }
export type { AuditLog }
