import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, fail, notFound, invalidRequest, withErrorHandler } from '@/lib/api'
import { getRequestId } from '@/lib/actor'
import { requireRole } from '@/lib/auth'
import { db } from '@/lib/db'
import { findTenantedUser, lastAdminGuard, revokeSessions, sanitizeUser } from '@/lib/provisioning'
import { invalidatePrincipal } from '@/lib/request-principal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * PATCH /api/admin/users/[id] — change a user's role / name / status.
 *
 * Body (any subset): { role?, name?, status? }
 *
 * Guards (src/lib/provisioning.ts):
 *   - the target must belong to the caller's tenant (404 otherwise)
 *   - no self-demotion / self-disable (self-lockout)
 *   - the last active admin cannot be demoted or disabled
 *   - role change or disable bumps tokenEpoch → every outstanding session
 *     for that user dies (forced re-login with fresh claims)
 */

const PatchSchema = z.object({
  role: z.enum(['viewer', 'reviewer', 'admin']).optional(),
  name: z.string().trim().max(200).nullable().optional(),
  status: z.enum(['active', 'disabled']).optional(),
})

export const PATCH = withErrorHandler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireRole(['admin'])
  const requestId = await getRequestId()
  const { id } = await ctx.params

  const body = await req.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) return invalidRequest(parsed.error)
  const { role, name, status } = parsed.data
  if (role === undefined && name === undefined && status === undefined) {
    return invalidRequest('nothing to update')
  }

  const target = await findTenantedUser(id)
  if (!target) return notFound('user not found')
  const tenantId = target.tenantId // tenanted lookup ⇒ same tenant as caller

  // Self-lockout guards.
  if (target.id === actor.id) {
    if (role !== undefined && role !== target.role) {
      return fail('you cannot change your own role', 409)
    }
    if (status !== undefined && status !== target.status) {
      return fail('you cannot disable or re-enable your own account', 409)
    }
  }

  // Last-admin guard (only fires when a guard-relevant field changes).
  if (target.role === 'admin' && target.status === 'active') {
    if ((role !== undefined && role !== 'admin') || (status !== undefined && status !== 'active')) {
      const guardErr = await lastAdminGuard(target.id, { newRole: role, newStatus: status })
      if (guardErr) return fail(guardErr, 409)
    }
  }

  // Role or status changes revoke sessions; name changes don't.
  const revokeWorthy =
    (role !== undefined && role !== target.role) ||
    (status !== undefined && status !== target.status)

  const data: Record<string, unknown> = {}
  if (role !== undefined) data.role = role
  if (name !== undefined) data.name = name
  if (status !== undefined) data.status = status

  const [updated] = await db.$transaction([
    db.user.update({
      where: { id: target.id },
      data: {
        ...data,
        ...(revokeWorthy ? { tokenEpoch: { increment: 1 } } : {}),
      },
    }),
  ])

  if (revokeWorthy) invalidatePrincipal(target.id)

  await db.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actor: actor.email,
      action: 'user_updated',
      entityType: 'user',
      entityId: target.id,
      detail:
        `Updated ${target.email}: ` +
        [role !== undefined ? `role→${role}` : null, status !== undefined ? `status→${status}` : null, name !== undefined ? 'name' : null]
          .filter(Boolean).join(', ') +
        (revokeWorthy ? ' (sessions revoked)' : '') +
        (requestId ? ` (request ${requestId})` : ''),
      requestId: requestId ?? undefined,
    },
  })

  return ok({ user: sanitizeUser(updated) })
})
