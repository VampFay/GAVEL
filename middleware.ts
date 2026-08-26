import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'

/**
 * Lightweight request-level middleware:
 *   1. Stamp `X-Request-Id` on every request (new UUIDv4 if not provided).
 *   2. Auth gate on mutating routes (POST/PATCH/PUT/DELETE) — see notes below.
 *
 * Auth strategy (placeholder until next-auth is wired):
 *   - GET routes are open for now (will be tightened by role later).
 *   - Mutating routes require `SHIPLEDGER_API_TOKEN` env var. If unset:
 *     - in dev: allow (so the sandbox works out of the box)
 *     - in prod: reject with 503
 *
 * Exempted from auth:
 *   - GET /api/health — liveness probe
 *   - OPTIONS — CORS preflight
 */

const MUTATION_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

export function middleware(req: NextRequest) {
  const { method, nextUrl } = req
  const path = nextUrl.pathname

  // ── Request ID propagation ──────────────────────────────────────────
  // Use the inbound header if present (from upstream gateway), else mint one.
  const incomingRequestId =
    req.headers.get('x-request-id') ?? req.headers.get('x-correlation-id')
  const requestId = incomingRequestId && incomingRequestId.length <= 128
    ? incomingRequestId
    : randomUUID()

  // Stamp it on the request so route handlers can read it via `headers()`.
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-request-id', requestId)
  requestHeaders.set('x-shipledger-actor', deriveActor(req))

  // Stamp it on the response so clients can correlate.
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  })
  response.headers.set('x-request-id', requestId)

  // ── Health probe is always open ────────────────────────────────────
  if (path === '/api/health' || method === 'OPTIONS') {
    return response
  }

  // ── GETs are open for now (will be tightened by role later) ────────
  if (!MUTATION_METHODS.has(method)) {
    return response
  }

  // ── Mutating-route auth ─────────────────────────────────────────────
  const expected = process.env.SHIPLEDGER_API_TOKEN
  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        {
          ok: false,
          error: 'server not configured for mutations (set SHIPLEDGER_API_TOKEN)',
          requestId,
        },
        { status: 503 }
      )
    }
    return response // dev: allow
  }

  const auth = req.headers.get('authorization') ?? ''
  const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!supplied || supplied !== expected) {
    return NextResponse.json(
      { ok: false, error: 'unauthorized', requestId },
      { status: 401 }
    )
  }
  return response
}

/**
 * Derive the actor identity from the request. Placeholder until next-auth
 * is wired — reads an `X-ShipLedger-Actor` header (set by an upstream
 * gateway) or falls back to `'anonymous'`. Hardcoded fallbacks like
 * `'reviewer@shipledger'` are explicitly forbidden.
 */
function deriveActor(req: NextRequest): string {
  const fromHeader = req.headers.get('x-shipledger-actor')
  if (fromHeader && fromHeader.length > 0 && fromHeader.length <= 254) {
    return fromHeader
  }
  return 'anonymous'
}

export const config = {
  matcher: ['/api/:path*'],
}
