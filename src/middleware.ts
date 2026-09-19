import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { verifyToken, type AuthClaims } from '@/lib/auth'
import { getAuthCookieName } from '@/lib/auth-cookie'
import { getEnv } from '@/lib/env'

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
 *      stamp the VERIFIED identity into request headers — `x-gavel-actor`
 *      (email), `x-gavel-user-id`, `x-gavel-role`. CRITICAL:
 *      this OVERWRITES any client-supplied `x-gavel-actor` header —
 *      that was the spoofing hole the audit flagged. Route handlers MUST
 *      read these middleware-stamped headers via `getCurrentActor()` /
 *      `getServerActor()` — never the inbound client-supplied header.
 *   3. Auth gate:
 *      - GET /api/health, OPTIONS — always open (liveness probe, CORS preflight)
 *      - /api/auth/login, /api/auth/logout — open (anyone can attempt to log in)
 *      - All other /api routes — require a verified JWT (any role).
 *        Specific mutating actions get tighter `requireRole(...)` checks
 *        in the route handler itself.
 *      - DEV ONLY: unauthenticated GETs pass as 'anonymous' so seeded demo
 *        data stays browsable. Prod (or GAVEL_REQUIRE_AUTH=true)
 *        requires auth on every route — see the comment at the bottom
 *        of this file for the NODE_ENV operational risk.
 *
 * What this is NOT:
 *   - Rate limiting. Login brute-force protection lives at the login route
 *     (sliding window, dual-keyed per IP + per email — src/lib/rate-limit.ts;
 *     single-process scope by design, swap for Redis before horizontal
 *     scaling).
 *   - CSRF protection beyond SameSite=Strict on the cookie. For
 *     server-rendered forms, add a CSRF token.
 */

const MUTATION_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

// Routes exempt from auth entirely (liveness, CORS, login/logout flow,
// invite + password-reset acceptance — all verify their own tokens).
const OPEN_PATHS = new Set([
  '/api/health',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/invite',
])

// Warn-once flag for the dev-only anonymous-GET escape hatch (below).
let warnedAnonymousGet = false

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
  requestHeaders.delete('x-gavel-actor')
  requestHeaders.delete('x-gavel-user-id')
  requestHeaders.delete('x-gavel-role')
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
    // read these via `getCurrentActor()` / `getServerActor()`. The epoch
    // header lets withErrorHandler compare the token's issue-epoch against
    // the live User.tokenEpoch (instant revocation — src/lib/api.ts).
    requestHeaders.set('x-gavel-actor', claims.email)
    requestHeaders.set('x-gavel-user-id', claims.sub)
    requestHeaders.set('x-gavel-role', claims.role)
    requestHeaders.set('x-gavel-epoch', String(claims.epoch))
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
  //
  // OPERATIONAL RISK (audit v2, finding #3): this dev escape hatch is
  // keyed on NODE_ENV, so it is WORTHLESS if the deploy target doesn't
  // actually set NODE_ENV=production. Two mitigations:
  //   1. GAVEL_REQUIRE_AUTH=true forces strict auth regardless of
  //      NODE_ENV — set it on any deploy whose NODE_ENV you don't trust.
  //   2. Warn once per process so a misconfigured deploy is visible in
  //      the logs instead of silently serving anonymous GETs.
  const env = getEnv()
  const requireAuth = env.NODE_ENV === 'production' || env.GAVEL_REQUIRE_AUTH === true
  if (!requireAuth && !MUTATION_METHODS.has(method)) {
    if (!warnedAnonymousGet) {
      warnedAnonymousGet = true
      console.warn(
        '⚠️  GAVEL: anonymous GET access is ENABLED (non-production NODE_ENV). ' +
        'Set NODE_ENV=production — or GAVEL_REQUIRE_AUTH=true — on every deploy ' +
        'that serves real client data.'
      )
    }
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
