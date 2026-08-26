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
 * What this is NOT: a CSRF token. For server-rendered forms, also add a
 * CSRF token (double-submit cookie or session-bound nonce). TODO when
 * adding the actual login UI form.
 */

const COOKIE_NAME = 'shipledger_token'
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
