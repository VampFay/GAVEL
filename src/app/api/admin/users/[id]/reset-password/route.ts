import { NextRequest } from 'next/server'
import { ok, notFound, withErrorHandler } from '@/lib/api'
import { getRequestId } from '@/lib/actor'
import { requireRole } from '@/lib/auth'
import { db } from '@/lib/db'
import { findTenantedUser, issueReset, publicBaseUrl } from '@/lib/provisioning'
import { invalidatePrincipal } from '@/lib/request-principal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/users/[id]/reset-password
 *
 * Forces a password reset for a same-tenant user:
 *   1. passwordHash is cleared → no password works (login rejects null hashes)
 *   2. tokenEpoch is bumped → every outstanding JWT dies immediately
 *   3. a 24h reset link is minted and returned (delivered by the admin
 *      over their own channel — no fake email)
 *
 * Also revives invite-pending users whose link expired: a fresh link is
 * a fresh link.
 */
export const POST = withErrorHandler(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireRole(['admin'])
  const requestId = await getRequestId()
  const { id } = await ctx.params

  const target = await findTenantedUser(id)
  if (!target) return notFound('user not found')

  await db.$transaction([
    db.user.update({
      where: { id: target.id },
      data: { passwordHash: null, tokenEpoch: { increment: 1 } },
    }),
  ])
  invalidatePrincipal(target.id)

  const reset = issueReset(target.id)

  await db.auditLog.create({
    data: {
      tenantId: target.tenantId,
      actorId: actor.id,
      actor: actor.email,
      action: 'password_reset_issued',
      entityType: 'user',
      entityId: target.id,
      detail: `Password reset issued for ${target.email} (sessions revoked)` +
        (requestId ? ` (request ${requestId})` : ''),
      requestId: requestId ?? undefined,
    },
  })

  return ok({
    user: { id: target.id, email: target.email },
    reset: {
      ...reset,
      url: `${publicBaseUrl()}${reset.path}`,
      note: 'Share over your own secure channel. The user sets a new password at this link; it expires in 24 hours.',
    },
  })
})
