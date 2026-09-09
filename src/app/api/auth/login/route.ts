import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ok, fail, invalidRequest, withErrorHandler } from '@/lib/api'
import { authenticate, signToken } from '@/lib/auth'
import { setAuthCookie } from '@/lib/auth-cookie'
import { rateLimitStatus, recordRateLimitHit, clientIpFrom } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LoginSchema = z.object({
  email: z.string().trim().email('invalid email').max(254).toLowerCase(),
  password: z.string().min(1, 'password required').max(1024),
})

/**
 * POST /api/auth/login
 *
 * Verifies email + password against the User table, issues an HS256 JWT,
 * and sets it as an httpOnly + SameSite=Strict cookie. The body returns
 * the (non-sensitive) user profile for the client to display.
 *
 * Brute-force protection (src/lib/rate-limit.ts): sliding window, keyed on
 * BOTH client IP (10 failures / 5 min) and target email (10 failures /
 * 15 min). Only FAILED attempts consume budget — a shared office NAT
 * logging in successfully all morning never locks itself out. Blocked
 * requests get 429 + Retry-After. Single-process scope by design; swap
 * for Redis if the deploy ever scales horizontally.
 */
const IP_MAX = 10
const IP_WINDOW_MS = 5 * 60_000
const EMAIL_MAX = 10
const EMAIL_WINDOW_MS = 15 * 60_000
export const POST = withErrorHandler(async (req: NextRequest) => {
  const text = await req.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    return invalidRequest('invalid json')
  }
  const parsed = LoginSchema.safeParse(body)
  if (!parsed.success) return invalidRequest(parsed.error)
  const { email, password } = parsed.data

  // ── Rate limit (failed attempts only — see route docblock) ────────
  const ip = clientIpFrom(req.headers)
  const ipKey = `login:ip:${ip}`
  const emailKey = `login:email:${email}`
  const ipLimit = rateLimitStatus(ipKey, IP_MAX, IP_WINDOW_MS)
  const emailLimit = rateLimitStatus(emailKey, EMAIL_MAX, EMAIL_WINDOW_MS)
  if (!ipLimit.allowed || !emailLimit.allowed) {
    const retryAfterSec = Math.max(ipLimit.retryAfterSec, emailLimit.retryAfterSec)
    return NextResponse.json(
      { ok: false, error: 'too many attempts — try again later' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSec) } }
    )
  }

  const user = await authenticate(email, password)
  if (!user) {
    // Generic message — don't leak whether the email exists.
    recordRateLimitHit(ipKey)
    recordRateLimitHit(emailKey)
    return fail('invalid email or password', 401)
  }

  const token = signToken({ sub: user.id, email: user.email, role: user.role })
  const res = ok({
    user: { id: user.id, email: user.email, role: user.role, name: user.name },
  })
  // Stamp the JWT as an httpOnly cookie so the browser auto-attaches it
  // to every subsequent request. The middleware reads + verifies it.
  return setAuthCookie(res, token)
})
