import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { verifyToken, type AuthClaims } from '@/lib/auth'
import { getAuthCookieName } from '@/lib/auth-cookie'

/**
 * Request-level middleware.
 *
 * IMPORTANT (file-location convention): this file MUST live at
 * `src/middleware.ts` (inside src/), NOT at the project root — a
 * root-level middleware.ts is silently ignored when the app uses the
 * src/ directory layout, which is how this codebase is organized.
 * Discovered the hard way while smoke-testing the auth flow.
 *
 * Runtime: runs in the Node.js runtime (set via `runtime: 'nodejs'` in
 * the config below) because JWT verification uses `node:crypto`'s
 * `createHmac` + `timingSafeEqual`, which the Edge Runtime doesn't
 * expose.
 *
 * What this middleware does:
 *   1. Stamp `X-Request-Id` on every request (new random if not provided).
 *   2. Verify the auth JWT (cookie OR Authorization: Bearer). On success,
 *      stamp the VERIFIED identity into request headers — `x-shipledger-actor`
 *      (email), `x-shipledger-user-id`, `x-shipledger-role`. CRITICAL:
 *      this OVERWRITES any client-supplied `x-shipledger-actor` header —
 *      that was the spoofing hole the audit flagged. Route handlers MUST
 *      read these middleware-stamped headers via `getCurrentActor()` /
 *      `getServerActor()` — never the inbound client-supplied header.
 *   3. Auth gate:
 *      - GET /api/health, OPTIONS — always open (liveness probe, CORS preflight)
 *      - /api/auth/login, /api/auth/logout — open (anyone can attempt to log in)
 *      - All other /api routes — require a verified JWT (any role).
 *        Specific mutating actions get tighter `requireRole(...)` checks
 *        in the route handler itself.
 *
 * What this is NOT:
 *   - Rate limiting. Add a sliding-window limiter keyed on user-id+IP
 *     before going live (see audit's "Operational basics").
 *   - CSRF protection beyond SameSite=Strict on the cookie. For
 *     server-rendered forms, add a CSRF token.
 */

const MUTATION_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

// Routes exempt from auth entirely (liveness, CORS, login/logout flow).
const OPEN_PATHS = new Set([
  '/api/health',
  '/api/auth/login',
  '/api/auth/logout',
])

export async function middleware(req: NextRequest) {
  const { method, nextUrl } = req
  const path = nextUrl.pathname

  // ── Request ID propagation ──────────────────────────────────────────
  const incomingRequestId =
    req.headers.get('x-request-id') ?? req.headers.get('x-correlation-id')
  const requestId =
    incomingRequestId && incomingRequestId.length <= 128
      ? incomingRequestId
      : randomBytes(16).toString('hex')

  // Start building the response with verified-identity headers stamped on.
  const requestHeaders = new Headers(req.headers)
  // ALWAYS overwrite client-supplied actor/userId/role headers — these
  // can ONLY come from a verified JWT (set below). A client sending one
  // in the inbound request gets ignored.
  requestHeaders.delete('x-shipledger-actor')
  requestHeaders.delete('x-shipledger-user-id')
  requestHeaders.delete('x-shipledger-role')
  requestHeaders.set('x-request-id', requestId)

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  })
  response.headers.set('x-request-id', requestId)

  // ── Health probe, CORS preflight, login/logout flow — always open ──
  if (path === '/api/health' || method === 'OPTIONS' || OPEN_PATHS.has(path)) {
    return response
  }

  // ── JWT verification ────────────────────────────────────────────────
  // Try the cookie first; fall back to Authorization: Bearer for API clients.
  const cookieName = getAuthCookieName()
  const cookieToken = req.cookies.get(cookieName)?.value
  const bearerAuth = req.headers.get('authorization') ?? ''
  const bearerToken = bearerAuth.startsWith('Bearer ')
    ? bearerAuth.slice(7)
    : null
  const token = cookieToken ?? bearerToken

  let claims: AuthClaims | null = null
  if (token) {
    claims = verifyToken(token)
  }

  if (claims) {
    // Stamp the verified identity into request headers — route handlers
    // read these via `getCurrentActor()` / `getServerActor()`.
    requestHeaders.set('x-shipledger-actor', claims.email)
    requestHeaders.set('x-shipledger-user-id', claims.sub)
    requestHeaders.set('x-shipledger-role', claims.role)
    // Re-create the response with the updated headers (NextResponse.next
    // snapshots headers at construction time; we need to re-build).
    const verified = NextResponse.next({
      request: { headers: requestHeaders },
    })
    verified.headers.set('x-request-id', requestId)
    return verified
  }

  // ── Unauthenticated request ────────────────────────────────────────
  // In dev, allow GETs through as 'anonymous' (so the seeded demo data
  // is browsable without logging in). In prod, every GET requires auth
  // too (the audit's P0 finding: GET routes were open to anyone).
  const isProd = process.env.NODE_ENV === 'production'
  if (!isProd && !MUTATION_METHODS.has(method)) {
    return response
  }
  // All mutations require auth, even in dev. Strict-by-default.
  return NextResponse.json(
    { ok: false, error: 'unauthorized', requestId },
    { status: 401 }
  )
}

export const config = {
  matcher: ['/api/:path*'],
  // Node.js runtime (not Edge) — required for node:crypto's createHmac
  // and timingSafeEqual used in JWT verification.
  runtime: 'nodejs',
}
