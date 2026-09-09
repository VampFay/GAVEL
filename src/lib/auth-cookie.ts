import { NextResponse } from 'next/server'
import { getEnv } from './env'

/**
 * Cookie helpers for the auth JWT.
 *
 * Cookie attributes:
 *   - httpOnly  — JS can't read it (XSS can't exfiltrate the token)
 *   - SameSite=Strict — browser doesn't send it on cross-site requests
 *     (mitigates CSRF for cookie-based auth)
 *   - Secure    — only set when in production (HTTPS). Dev is HTTP.
 *   - Path=/    — sent on every same-origin request
 *   - Max-Age=604800 — 7 days (matches TOKEN_TTL_SECONDS in auth.ts)
 *
 * What this is NOT: a CSRF token. None is needed for the current
 * architecture, and here is why (documented so this isn't "trust me"):
 *   1. SameSite=Strict — the browser never attaches this cookie to a
 *      cross-site request, which is the CSRF primitive itself.
 *   2. JSON-only bodies — every mutation parses req.text() as JSON and
 *      rejects anything else; a cross-site <form> can only post
 *      application/x-www-form-urlencoded / multipart, never JSON with
 *      our shapes. No CORS headers are emitted, so fetch() from another
 *      origin dies in preflight.
 * If server-rendered HTML forms are ever introduced (form-action posts
 * without JSON), add a double-submit token or session nonce THEN.
 */

const COOKIE_NAME = 'gavel_token'
const TTL_SECONDS = 7 * 24 * 60 * 60

export function setAuthCookie(res: NextResponse, token: string): NextResponse {
  const env = getEnv()
  const isProd = env.NODE_ENV === 'production'
  // cookie().set() accepts the cookie value as the second arg, and an
  // options object as the third.
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProd,
    path: '/',
    maxAge: TTL_SECONDS,
  })
  return res
}

export function clearAuthCookie(res: NextResponse): NextResponse {
  res.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  })
  return res
}

export function getAuthCookieName(): string {
  return COOKIE_NAME
}
