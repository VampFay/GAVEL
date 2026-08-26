/**
 * Centralized API helpers: response envelope, error mapping, request-id
 * propagation, and actor derivation.
 */

import { NextResponse } from 'next/server'
import type { ZodError } from 'zod'

// ───────────────────────────── Response envelope ─────────────────────

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
 * Wrap an async route handler so:
 *   - Prisma P2025 (record not found) → 404
 *   - Zod errors → 400
 *   - Auth errors → 401/403
 *   - Everything else → 500 with a generic message + server-side console.error
 *     (does NOT leak `err.message` to the client)
 */
export function withErrorHandler<TArgs extends unknown[]>(
  fn: (...args: TArgs) => Promise<Response>
): (...args: TArgs) => Promise<Response> {
  return async (...args: TArgs) => {
    try {
      return await fn(...args)
    } catch (err: unknown) {
      // P2025: record not found (Prisma)
      if (
        err !== null &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code === 'P2025'
      ) {
        return notFound('record not found')
      }
      // Log server-side, return generic message.
      console.error('[api] unhandled error', err)
      return fail('internal server error', 500)
    }
  }
}
