import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ok, invalidRequest, withErrorHandler } from '@/lib/api'
import { CreateClientSchema } from '@/lib/schemas'
import { getRequestId } from '@/lib/actor'
import { requireRole } from '@/lib/auth'
import { currentTenantId } from '@/lib/tenant-context'

export const dynamic = 'force-dynamic'

/** Client list, scoped to the caller's tenant by the Prisma extension. */
export const GET = withErrorHandler(async () => {
  const clients = await db.client.findMany({
    select: { id: true, name: true, industry: true, sizeBand: true },
    orderBy: { name: 'asc' },
  })
  return ok({ clients })
})

export const POST = withErrorHandler(async (req: NextRequest) => {
  // Authorization: admin only — client onboarding is a privileged action
  // (creates the org tree that every downstream contract/finding depends on).
  const actor = await requireRole(['admin'])
  const requestId = await getRequestId()

  const text = await req.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    return invalidRequest('invalid json')
  }
  const parsed = CreateClientSchema.safeParse(body)
  if (!parsed.success) return invalidRequest(parsed.error)
  const data = parsed.data

  // Wrap client create + audit-log entry in a transaction. The previous
  // implementation wrote the client row but never logged the action.
  const tenantId = currentTenantId()
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: 'no tenant context' }, { status: 500 })
  }
  const client = await db.$transaction(async tx => {
    const c = await tx.client.create({
      data: {
        tenantId,
        name: data.name,
        industry: data.industry,
        sizeBand: data.sizeBand,
        contactName: data.contactName,
        contactEmail: data.contactEmail,
      },
    })
    await tx.auditLog.create({
      data: {
        tenantId,
        actorId: actor.id,
        actor: actor.email,
        action: 'create_client',
        entityType: 'client',
        entityId: c.id,
        detail: `Client created: ${data.name}`,
        requestId: requestId ?? undefined,
      },
    })
    return c
  })

  return ok({ client })
})
