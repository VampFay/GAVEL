import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, fail, invalidRequest, withErrorHandler } from '@/lib/api'
import { authenticate, signToken } from '@/lib/auth'
import { setAuthCookie } from '@/lib/auth-cookie'

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
 * Rate-limit this endpoint before going live (TODO: a sliding-window
 * in-memory limit keyed on email + IP — see audit's "Operational basics").
 */
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

  const user = await authenticate(email, password)
  if (!user) {
    // Generic message — don't leak whether the email exists.
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
