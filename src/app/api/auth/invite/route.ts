import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ok, fail, invalidRequest, withErrorHandler } from '@/lib/api'
import { getRequestId } from '@/lib/actor'
import { verifyPurposeToken, hashPassword, passwordPolicyError } from '@/lib/auth'
import { db } from '@/lib/db'
import { runWithTenant } from '@/lib/tenant-context'
import { checkRateLimit, recordRateLimitHit, clientIpFrom } from '@/lib/rate-limit-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/invite — accept an invite or consume a password reset.
 *
 * Body: { token, password }
 *
 * The token is a signed purpose-token (src/lib/auth.ts): 'invite' (72h)
 * or 'reset' (24h). Both converge here on purpose — the action is the
 * same: SET a password for the referenced user. On success the user can
 * sign in normally; no session is issued implicitly (the login form is
 * one click away, and forcing an explicit sign-in keeps the flow honest
 * about who typed the password).
 *
 * Guards:
 *   - rate limited per IP (10 attempts / 15 min, failures counted) — token
 *     guessing gets the same brake as password guessing
 *   - disabled accounts cannot be reactivated by setting a password
 *   - password policy enforced (length-first, NIST-style)
 *   - the user's epoch is NOT bumped (no sessions exist to kill — the
 *     password either never existed or was just invalidated by the admin)
 *
 * This route is unauthenticated by design; middleware leaves it open
 * (add to OPEN_PATHS below in middleware.ts — see the note in that file).
 */

const AcceptSchema = z.object({
  token: z.string().min(20).max(2048),
  password: z.string().min(1).max(1024),
})

const MAX = 10
const WINDOW_MS = 15 * 60_000

export const POST = withErrorHandler(async (req: NextRequest) => {
  const requestId = await getRequestId()

  const ip = clientIpFrom(req.headers)
  const key = `invite:ip:${ip}`
  const limit = await checkRateLimit(key, MAX, WINDOW_MS)
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: 'too many attempts — try again later' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    )
  }

  const body = await req.json().catch(() => null)
  const parsed = AcceptSchema.safeParse(body)
  if (!parsed.success) return invalidRequest(parsed.error)
  const { token, password } = parsed.data

  const policyErr = passwordPolicyError(password)
  if (policyErr) return invalidRequest(policyErr)

  // Try both purposes — the user only ever sees "set your password".
  const userId = verifyPurposeToken(token, 'invite') ?? verifyPurposeToken(token, 'reset')
  if (!userId) {
    await recordRateLimitHit(key, WINDOW_MS)
    return fail('this link is invalid or has expired — ask your administrator for a new one', 401)
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, status: true, tenantId: true },
  })
  if (!user) return fail('this link is invalid or has expired', 401)
  if (user.status === 'disabled') {
    return fail('this account is disabled — contact your administrator', 403)
  }

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password) },
  })

  // Audit entry under the user's own tenant (the wrapper's anonymous
  // context is overridden here — the actor is the invitee themselves).
  if (user.tenantId) {
    await runWithTenant(user.tenantId, async () => {
      await db.auditLog.create({
        data: {
          actor: user.email,
          action: 'account_activated',
          entityType: 'user',
          entityId: user.id,
          detail: 'Password set via invite/reset link' + (requestId ? ` (request ${requestId})` : ''),
          requestId: requestId ?? undefined,
        },
      })
    })
  }

  return ok({
    email: user.email,
    message: 'Password set — you can sign in now.',
  })
})
