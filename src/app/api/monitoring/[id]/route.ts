import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, notFound, invalidRequest, withErrorHandler } from '@/lib/api'
import { AckAlertSchema, ToggleMonitoringSchema } from '@/lib/schemas'
import { getCurrentActor, getRequestId } from '@/lib/actor'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/monitoring/[id]
 *
 * Body: { action: 'ack' | 'unack', acknowledged: boolean } OR { action: 'toggle', alertsEnabled: boolean }
 *
 * Wires up the previously fake ackAlert (was fire-and-forget local state)
 * and the previously inert <Switch> in monitoring-view.tsx.
 */
export const PATCH = withErrorHandler(
  async (
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    const { id } = await params

    const text = await req.text()
    let body: unknown
    try {
      body = text ? JSON.parse(text) : {}
    } catch {
      return invalidRequest('invalid json')
    }

    const action = (body as { action?: string }).action

    const actor = await getCurrentActor()
    const requestId = await getRequestId()

    if (action === 'toggle') {
      const parsed = ToggleMonitoringSchema.safeParse(body)
      if (!parsed.success) return invalidRequest(parsed.error)
      const updated = await db.monitoredProject.update({
        where: { id },
        data: { alertsEnabled: parsed.data.alertsEnabled },
      })
      await db.auditLog.create({
        data: {
          actor,
          action: 'toggle_monitoring',
          entityType: 'monitored_project',
          entityId: id,
          detail: `alertsEnabled -> ${parsed.data.alertsEnabled}`,
          requestId: requestId ?? undefined,
        },
      })
      return ok({ monitored: updated })
    }

    if (action === 'ack' || action === 'unack') {
      const parsed = AckAlertSchema.safeParse(body)
      if (!parsed.success) return invalidRequest(parsed.error)
      const updated = await db.alert.update({
        where: { id },
        data: {
          acknowledged: parsed.data.acknowledged,
          acknowledgedAt: parsed.data.acknowledged ? new Date() : null,
        },
      })
      await db.auditLog.create({
        data: {
          actor,
          action: action === 'ack' ? 'ack_alert' : 'unack_alert',
          entityType: 'alert',
          entityId: id,
          detail: `Alert ${action}ed`,
          requestId: requestId ?? undefined,
        },
      })
      return ok({ alert: updated })
    }

    return invalidRequest(`invalid action: ${action ?? 'none'} (expected 'ack' | 'unack' | 'toggle')`)
  }
)

/**
 * GET /api/monitoring/[id] — single monitored project detail.
 */
export const GET = withErrorHandler(
  async (
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    const { id } = await params
    const monitored = await db.monitoredProject.findUnique({
      where: { id },
      include: {
        project: {
          select: {
            name: true,
            id: true,
            client: { select: { name: true, id: true } },
            contract: { select: { title: true, totalValue: true, currency: true } },
          },
        },
        alerts: { orderBy: { createdAt: 'desc' }, take: 50 },
        driftSnapshots: { orderBy: { weekStart: 'desc' }, take: 12 },
      },
    })
    if (!monitored) return notFound('monitored project not found')
    return ok({ monitored })
  }
)
