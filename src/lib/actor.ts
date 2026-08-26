import { cookies, headers } from 'next/headers'

/**
 * Derive the current actor (user identity) from the request context.
 *
 * Today this is a placeholder that reads an optional `X-ShipLedger-Actor`
 * header (set by middleware when sessions are wired) or falls back to
 * `'anonymous'`. Once next-auth is configured, this should pull the email
 * from the session instead.
 *
 * Hardcoded fallbacks like `'intake@shipledger'` and `'reviewer@shipledger'`
 * are explicitly forbidden — see the audit log trust-anchor concerns.
 */
export async function getCurrentActor(): Promise<string> {
  const h = await headers()
  const fromHeader = h.get('x-shipledger-actor')
  if (fromHeader && fromHeader.length > 0 && fromHeader.length <= 254) {
    return fromHeader
  }
  return 'anonymous'
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
