import { NextRequest } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { ok, fail, invalidRequest, withErrorHandler } from '@/lib/api'
import { getRequestId } from '@/lib/actor'
import { requireRole } from '@/lib/auth'
import { db } from '@/lib/db'
import { currentTenantId } from '@/lib/tenant-context'
import { sanitizeUser, issueInvite, publicBaseUrl, PROVISIONABLE_ROLES } from '@/lib/provisioning'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/users — list the caller's tenant users (admin only).
 *
 * Returns sanitized rows only — no password hashes, no token epochs.
 * Cross-tenant users are structurally invisible (filtered by tenantId).
 *
 * POST /api/admin/users — create a user in the caller's tenant.
 *
 * The user is created WITHOUT a password (passwordHash: null) and an
 * invite link is minted (72h). Without an SMTP integration the link is
 * returned in the response for the admin to deliver over their own
 * channel — email delivery is deliberately NOT faked. The invitee sets
 * their password at /login?invite=<token> (POST /api/auth/invite).
 *
 * Body: { email, name?, role }
 */

const CreateSchema = z.object({
  email: z.string().trim().email('invalid email').max(254).toLowerCase(),
  name: z.string().trim().max(200).optional(),
  role: z.enum(['viewer', 'reviewer', 'admin']),
})

export const GET = withErrorHandler(async (_req: NextRequest) => {
  await requireRole(['admin'])
  const tenantId = currentTenantId()
  if (!tenantId) return fail('no tenant context', 500)

  const users = await db.user.findMany({
    where: { tenantId },
    select: {
      id: true, email: true, name: true, role: true, status: true,
      tenantId: true, passwordHash: true, createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })
  return ok({ users: users.map(sanitizeUser) })
})

export const POST = withErrorHandler(async (req: NextRequest) => {
  const actor = await requireRole(['admin'])
  const requestId = await getRequestId()
  const tenantId = currentTenantId()
  if (!tenantId) return fail('no tenant context', 500)

  const body = await req.json().catch(() => null)
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) return invalidRequest(parsed.error)
  const { email, name, role } = parsed.data

  if (!PROVISIONABLE_ROLES.includes(role)) {
    return invalidRequest('role must be viewer, reviewer or admin')
  }

  const existing = await db.user.findUnique({ where: { email }, select: { id: true } })
  if (existing) return fail('a user with this email already exists', 409)

  let user
  try {
    user = await db.user.create({
      data: { tenantId, email, name: name ?? null, role, passwordHash: null, status: 'active' },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return fail('a user with this email already exists', 409)
    }
    throw err
  }

  const invite = issueInvite(user.id)

  await db.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actor: actor.email,
      action: 'user_created',
      entityType: 'user',
      entityId: user.id,
      detail: `Invited ${email} as ${role}` + (requestId ? ` (request ${requestId})` : ''),
      requestId: requestId ?? undefined,
    },
  })

  return ok({
    user: sanitizeUser(user),
    invite: {
      ...invite,
      url: `${publicBaseUrl()}${invite.path}`,
      note: 'Deliver this link over your own secure channel — GAVEL does not send email. It expires in 72 hours.',
    },
  })
})
