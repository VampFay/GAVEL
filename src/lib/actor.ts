import { cookies, headers } from 'next/headers'

/**
 * Request-context helpers for API routes.
 *
 * Auth model (see src/lib/auth.ts):
 *   - Middleware verifies the JWT on every request and stamps the
 *     VERIFIED identity into these headers: `x-gavel-actor`
 *     (email), `x-gavel-user-id`, `x-gavel-role`.
 *   - `getCurrentActor()` / `getRequestActor()` / `getRequestId()` read
 *     those VERIFIED headers — they never read the client-supplied
 *     `x-gavel-actor` header. That was the spoofing hole the
 *     audit flagged (the body-fixed `actor` field was closed, but the
 *     header-stamped version had the identical bug one layer down).
 *
 * For role gating, prefer `requireRole(...)` / `requireActor()` from
 * `src/lib/auth.ts` — these throw AuthError(401/403) which withErrorHandler
 * maps correctly. The `getCurrentActor()` here returns `'anonymous'` for
 * unauthenticated calls — used only by audit-log entries that legitimately
 * need to record an unauthenticated attempt.
 */

/**
 * The actor email stamped by middleware from the verified JWT.
 * Returns `'anonymous'` if no verified actor (unauthenticated request).
 */
export async function getCurrentActor(): Promise<string> {
  const h = await headers()
  // The `x-gavel-actor` header is set BY MIDDLEWARE from verified
  // JWT claims — NOT from a client-supplied header. (Clients can still
  // SEND the header, but middleware overwrites it after JWT verification.)
  const fromHeader = h.get('x-gavel-actor')
  if (fromHeader && fromHeader.length > 0 && fromHeader.length <= 254) {
    return fromHeader
  }
  return 'anonymous'
}

/**
 * The verified user ID stamped by middleware from the JWT, or null.
 * Use this for FK writes (`AuditLog.actorId`, `Finding.reviewedById`).
 */
export async function getCurrentUserId(): Promise<string | null> {
  const h = await headers()
  return h.get('x-gavel-user-id')
}

/**
 * Request ID propagation — middleware stamps an `X-Request-Id` header on
 * every request. Routes that write audit-log entries should include it
 * so issues can be correlated across logs.
 */
export async function getRequestId(): Promise<string | null> {
  const h = await headers()
  const fromHeader = h.get('x-request-id')
  if (!fromHeader) return null
  return fromHeader.length <= 128 ? fromHeader : fromHeader.slice(0, 128)
}

/** Convenience: read a JSON body, returning null on malformed JSON (NOT a 200). */
export async function parseJsonBody<T>(
  req: Request
): Promise<{ ok: true; data: T } | { ok: false; error: 'invalid json' }> {
  try {
    const text = await req.text()
    if (!text) return { ok: false, error: 'invalid json' }
    return { ok: true, data: JSON.parse(text) as T }
  } catch {
    return { ok: false, error: 'invalid json' }
  }
}

/** Read a boolean cookie — used for client-side feature toggles. */
export async function readCookie(name: string): Promise<string | undefined> {
  const c = await cookies()
  return c.get(name)?.value
}
