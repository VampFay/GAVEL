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
// Tenant scoping (production blocker #2)
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
 */
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
 */
function buildTenantScopedClient(base: PrismaClient, tenantId: string) {
  return base.$extends({
    name: 'tenantScoping',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !SCOPED_MODELS.has(model)) {
            return query(args)
          }
          const a = args as AnyArgs

          // 1) List/count/many-writes — merge the tenant filter into where.
          if (WHERE_MERGE_OPS.has(operation)) {
            const merged = { AND: [{ tenantId }, a.where ?? {}] }
            return query({ ...a, where: merged })
          }

          // 2) Unique-keyed reads — fetch, then mask cross-tenant rows.
          if (UNIQUE_READ_OPS.has(operation)) {
            const result = await query(a)
            return maskCrossTenantResult(operation, result, tenantId)
          }

          // 3) Creates — stamp the tenant when the caller didn't.
          if (operation === 'create' || operation === 'createManyAndReturn') {
            if (a.data && typeof a.data === 'object' && !Array.isArray(a.data)) {
              if (a.data.tenantId === undefined) a.data.tenantId = tenantId
            }
            return query(a)
          }
          if (operation === 'createMany') {
            if (Array.isArray(a.data)) {
              for (const row of a.data) {
                if (row && row.tenantId === undefined) row.tenantId = tenantId
              }
            } else if (a.data && typeof a.data === 'object' && a.data.tenantId === undefined) {
              a.data.tenantId = tenantId
            }
            return query(a)
          }

          // 4) Upsert — stamp the create side; the where side is
          //    unique-keyed (Prisma type system) and every route resolves
          //    the target through a scoped read first (verified across
          //    ingest / reconcile / findings / clients / connectors).
          if (operation === 'upsert') {
            if (a.create && a.create.tenantId === undefined) a.create.tenantId = tenantId
            return query(a)
          }

          // 5) Single update/delete — Prisma requires unique-shaped where,
          //    so we cannot merge here. Defense: routes only ever pass ids
          //    that came out of a scoped read (step 2) in the same request,
          //    and the AuditLog immutability guard below blocks the
          //    dangerous variants on the audit table in production.
          return query(a)
        },
      },
    },
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
    if (!ctx || ctx.unscoped) {
      // Process-level code: scripts, bootstrap, CLI. Unscoped by design.
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
