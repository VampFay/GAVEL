import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, notFound, invalidRequest, withErrorHandler } from '@/lib/api'
import { AckAlertSchema, ToggleMonitoringSchema } from '@/lib/schemas'
import { getRequestId } from '@/lib/actor'
import { requireRole } from '@/lib/auth'
import { currentTenantId } from '@/lib/tenant-context'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/monitoring/[id]
 *
 * Body: { action: 'ack' | 'unack', acknowledged: boolean } OR { action: 'toggle', alertsEnabled: boolean }
 *
 * Wires up the previously fake ackAlert (was fire-and-forget local state)
 * and the previously inert <Switch> in monitoring-view.tsx.
 *
 * Auth: reviewer+ (anyone who can act on findings can ack alerts).
 */
export const PATCH = withErrorHandler(
  async (
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    const { id } = await params

    // Authorization: reviewer+ to ack alerts or toggle monitoring.
    const actor = await requireRole(['reviewer', 'admin'])
    const requestId = await getRequestId()

    const text = await req.text()
    let body: unknown
    try {
      body = text ? JSON.parse(text) : {}
    } catch {
      return invalidRequest('invalid json')
    }

    const action = (body as { action?: string }).action

    if (action === 'toggle') {
      const parsed = ToggleMonitoringSchema.safeParse(body)
      if (!parsed.success) return invalidRequest(parsed.error)
      // Tenant guard: scoped read masks cross-tenant rows as null (404).
      const target = await db.monitoredProject.findUnique({ where: { id }, select: { id: true } })
      if (!target) return notFound('monitored project not found')
      const tenantId = currentTenantId()
      if (!tenantId) return notFound('monitored project not found')
      const updated = await db.$transaction(async tx => {
        const m = await tx.monitoredProject.update({
          where: { id },
          data: { alertsEnabled: parsed.data.alertsEnabled },
        })
        await tx.auditLog.create({
          data: {
            tenantId,
            actorId: actor.id,
            actor: actor.email,
            action: 'toggle_monitoring',
            entityType: 'monitored_project',
            entityId: id,
            detail: `alertsEnabled -> ${parsed.data.alertsEnabled}`,
            requestId: requestId ?? undefined,
          },
        })
        return m
      })
      return ok({ monitored: updated })
    }

    if (action === 'ack' || action === 'unack') {
      const parsed = AckAlertSchema.safeParse(body)
      if (!parsed.success) return invalidRequest(parsed.error)
      // Tenant guard: scoped read masks cross-tenant rows as null (404).
      const target = await db.alert.findUnique({ where: { id }, select: { id: true } })
      if (!target) return notFound('alert not found')
      const tenantId = currentTenantId()
      if (!tenantId) return notFound('alert not found')
      const updated = await db.$transaction(async tx => {
        const a = await tx.alert.update({
          where: { id },
          data: {
            acknowledged: parsed.data.acknowledged,
            acknowledgedAt: parsed.data.acknowledged ? new Date() : null,
            acknowledgedById: parsed.data.acknowledged ? actor.id : null,
          },
        })
        await tx.auditLog.create({
          data: {
            tenantId,
            actorId: actor.id,
            actor: actor.email,
            action: action === 'ack' ? 'ack_alert' : 'unack_alert',
            entityType: 'alert',
            entityId: id,
            detail: `Alert ${action}ed`,
            requestId: requestId ?? undefined,
          },
        })
        return a
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
