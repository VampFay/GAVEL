// GAVEL — per-request tenant context (production blocker #2).
//
// HOW IT FLOWS:
//   middleware verifies the JWT and stamps x-gavel-user-id
//     → withErrorHandler (src/lib/api.ts) resolves the user's tenant via the
//       cached principal (src/lib/request-principal.ts) and calls the route
//       handler inside runWithTenant(tenantId, …)
//         → the Prisma client extension (src/lib/db.ts) reads the context on
//           every query and hard-scopes reads + stamps writes.
//
// WHY AsyncLocalStorage and not a global: the context must be per-request,
// never shared across concurrent requests, and it must propagate through
// `await` boundaries without threading a parameter through every function.
//
// FAIL-CLOSED SEMANTICS:
//   - Context present with a tenantId → queries scoped to that tenant.
//   - Context present with tenantId === null (authenticated but tenantless
//     user, or an anonymous request in production) → scoped queries THROW
//     TenantContextError. A tenantless identity must never read client data.
//   - Context ABSENT → queries run unscoped. This state exists ONLY for
//     process-level code: the bootstrap self-heal, the seed/wipe scripts and
//     CLI tools, which deliberately run inside runUnscoped() (or stamp
//     tenantId explicitly on every write). Route handlers can never land
//     here: withErrorHandler always enters a context.
//
// The demo tenant id is a stable string (not a cuid) so reseeding the
// sandbox never changes it — surviving sessions stay valid (same reasoning
// as the stable demo user ids).

import { AsyncLocalStorage } from 'node:async_hooks'

export const DEMO_TENANT_ID = 'demo-tenant'

export class TenantContextError extends Error {
  status = 500
  constructor(message: string) {
    super(message)
    this.name = 'TenantContextError'
  }
}

interface TenantCtx {
  tenantId: string | null
  /** true = explicitly unscoped (scripts, bootstrap, CLI) */
  unscoped: boolean
}

const storage = new AsyncLocalStorage<TenantCtx>()

/** Run `fn` with every contained DB query scoped to `tenantId`. */
export function runWithTenant<T>(tenantId: string | null, fn: () => T): T {
  return storage.run({ tenantId, unscoped: false }, fn)
}

/**
 * Run `fn` with scoping explicitly DISABLED. CLI/tools only — never call
 * this from request-handling code. Greppable on purpose so an audit can
 * find every unscoped access path instantly.
 */
export function runUnscoped<T>(fn: () => T): T {
  return storage.run({ tenantId: null, unscoped: true }, fn)
}

/** Raw context (undefined when no context was entered). */
export function getTenantContext(): TenantCtx | undefined {
  return storage.getStore()
}

/** Current tenant id, or null when unscoped/no context. Throws never. */
export function currentTenantId(): string | null {
  return storage.getStore()?.tenantId ?? null
}

/**
 * The tenant id for scoped queries. Throws TenantContextError when a
 * scoped query runs inside a tenantless context (fail closed — see the
 * file header). The Prisma extension is the only intended caller.
 */
export function requireTenantId(): string {
  const ctx = storage.getStore()
  if (!ctx || ctx.unscoped) return '' // caller treats '' as "no scoping" (unscoped mode)
  if (ctx.tenantId === null) {
    throw new TenantContextError(
      'tenant context is required for this query but none was established ' +
      '(tenantless user or anonymous request) — refusing to run unscoped'
    )
  }
  return ctx.tenantId
}
