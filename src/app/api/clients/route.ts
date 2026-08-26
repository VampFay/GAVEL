import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, invalidRequest, withErrorHandler } from '@/lib/api'
import { CreateClientSchema } from '@/lib/schemas'
import { getCurrentActor, getRequestId } from '@/lib/actor'

export const dynamic = 'force-dynamic'

export async function GET() {
  // Public list of clients. The previous implementation returned `id`,
  // `name`, `industry`, `sizeBand` only — no PII. Keeping it that way.
  const clients = await db.client.findMany({
    select: { id: true, name: true, industry: true, sizeBand: true },
    orderBy: { name: 'asc' },
  })
  return ok({ clients })
}

export const POST = withErrorHandler(async (req: NextRequest) => {
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

  const actor = await getCurrentActor()
  const requestId = await getRequestId()

  // Wrap client create + audit-log entry in a transaction. The previous
  // implementation wrote the client row but never logged the action.
  const client = await db.$transaction(async tx => {
    const c = await tx.client.create({
      data: {
        name: data.name,
        industry: data.industry,
        sizeBand: data.sizeBand,
        contactName: data.contactName,
        contactEmail: data.contactEmail,
      },
    })
    await tx.auditLog.create({
      data: {
        actor,
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
