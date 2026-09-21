/**
 * Centralized API helpers: response envelope, error mapping, request-id
 * propagation, actor derivation — and the request-level TENANT CONTEXT.
 *
 * The tenant flow (production blocker #2):
 *   middleware verifies the JWT → stamps x-gavel-user-id / x-gavel-epoch
 *   → this wrapper resolves the live principal (cached ≤30s; see
 *   src/lib/request-principal.ts) → rejects disabled users and revoked
 *   token epochs → enters runWithTenant(principal.tenantId) so every DB
 *   query the route makes is hard-scoped by the Prisma client extension
 *   (src/lib/db.ts).
 *
 * Anonymous requests (dev-only hatch, see middleware): scoped to the demo
 * tenant so the browsable demo keeps working; in production an anonymous
 * request that somehow reached a scoped query fails CLOSED.
 */

import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import type { ZodError } from 'zod'
import { runWithTenant, DEMO_TENANT_ID } from './tenant-context'
import { getRequestPrincipal } from './request-principal'
import { getEnv } from './env'

// ───────────────────────────── Response envelope ─────────────────────────────

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, ...data }, init)
}

export function fail(
  error: string | { code: string; message: string },
  status: number = 400
) {
  const payload =
    typeof error === 'string'
      ? { ok: false, error }
      : { ok: false, error: error.message, code: error.code }
  return NextResponse.json(payload, { status })
}

export function notFound(what: string = 'not found') {
  return NextResponse.json({ ok: false, error: what }, { status: 404 })
}

export function unauthorized() {
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
}

export function forbidden() {
  return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
}

export function invalidRequest(err: ZodError | string) {
  if (typeof err === 'string') {
    return NextResponse.json({ ok: false, error: err }, { status: 400 })
  }
  const first = err.issues[0]
  return NextResponse.json(
    {
      ok: false,
      error: first?.message ?? 'invalid request',
      path: first?.path,
    },
    { status: 400 }
  )
}

/**
 * Wrap an async route handler. In addition to the error mapping below,
 * this establishes the per-request tenant context and enforces the live
 * principal checks (disabled account, revoked token epoch).
 *
 * Error mapping:
 *   - AuthError → 401 or 403 (see src/lib/auth.ts)
 *   - TenantContextError → 500 (a scoped query ran without a tenant —
 *     a bug or a misconfigured deploy, never a client mistake)
 *   - Prisma P2025 (record not found) → 404
 *   - Zod errors → 400
 *   - Everything else → 500 with a generic message + server-side console.error
 *     (does NOT leak `err.message` to the client)
 */
export function withErrorHandler<TArgs extends unknown[]>(
  fn: (...args: TArgs) => Promise<Response>
): (...args: TArgs) => Promise<Response> {
  return async (...args: TArgs) => {
    try {
      // ── Resolve identity + establish tenant context ──────────────
      const h = await headers()
      const userId = h.get('x-gavel-user-id')
      const tokenEpoch = h.get('x-gavel-epoch')

      if (userId) {
        const principal = await getRequestPrincipal(userId)
        if (!principal) {
          // The JWT verified but the user row is gone (deleted data,
          // reseeded DB). 401, not 500-through-FK.
          return unauthorized()
        }
        if (principal.status === 'disabled') {
          return NextResponse.json(
            { ok: false, error: 'account disabled — contact your administrator' },
            { status: 401 }
          )
        }
        // Epoch mismatch = a token issued BEFORE the last revoke-worthy
        // change (password reset, role change, disable). Missing header
        // (legacy token, epoch 0) matches the default epoch 0.
        const headerEpoch = tokenEpoch === null ? 0 : Number.parseInt(tokenEpoch, 10)
        if (!Number.isFinite(headerEpoch) || headerEpoch !== principal.tokenEpoch) {
          return NextResponse.json(
            { ok: false, error: 'session revoked — sign in again' },
            { status: 401 }
          )
        }
        // NOTE the `await`: WITHOUT it, `return runWithTenant(...)` would
        // hand a rejected promise STRAIGHT OUT of this try block (the
        // classic return-vs-return-await trap) and every AuthError would
        // surface as a raw 500 instead of its mapped 401/403.
        return await runWithTenant(principal.tenantId, () => fn(...args))
      }

      // Anonymous: only reachable in dev (middleware blocks anonymous
      // requests in production). Scope to the demo tenant so the browsable
      // demo keeps working; production fails closed via TenantContextError.
      const env = getEnv()
      const anonymousTenant = env.NODE_ENV !== 'production' ? DEMO_TENANT_ID : null
      return await runWithTenant(anonymousTenant, () => fn(...args))
    } catch (err: unknown) {
      // NOTE: error-shape checks are deliberately clone-tolerant (name /
      // duck-typed fields, never `instanceof`). Next.js/Turbopack can hand
      // the catch a CLONED error that fails `instanceof Error` while keeping
      // name/message/status — observed live with AuthError rendering as a
      // 500 before this was hardened.
      const e = err as { name?: unknown; message?: unknown; status?: unknown; code?: unknown } | null
      const name = typeof e?.name === 'string' ? e.name : ''
      const message = typeof e?.message === 'string' ? e.message : 'internal server error'
      const status = typeof e?.status === 'number' ? e.status : undefined
      const code = typeof e?.code === 'string' ? e.code : undefined

      // AuthError → 401 or 403 (mapped from err.status).
      if (name === 'AuthError') {
        return NextResponse.json(
          { ok: false, error: message },
          { status: status ?? 500 }
        )
      }
      // Tenant isolation violations are server-side bugs — log loudly.
      if (name === 'TenantContextError') {
        console.error('[api] tenant context error:', message)
        return fail('tenant isolation enforced: no tenant context for this request', 500)
      }
      // ConnectorErrors carry user-safe messages + a chosen status
      // (bad credentials → 401/403, rate limit → 429, upstream down → 504).
      if (name === 'ConnectorError') {
        return NextResponse.json({ ok: false, error: message }, { status: status || 502 })
      }
      // SourceFetchError (remote SOW fetching) — same contract: safe
      // message + chosen status (SSRF guard → 400, not found → 404,
      // too large → 413, wrong type → 415, upstream down → 504).
      if (name === 'SourceFetchError') {
        return NextResponse.json({ ok: false, error: message }, { status: status || 502 })
      }
      // P2025: record not found (Prisma)
      if (code === 'P2025') {
        return notFound('record not found')
      }
      // Log server-side, return generic message.
      console.error('[api] unhandled error', err)
      return fail('internal server error', 500)
    }
  }
}
