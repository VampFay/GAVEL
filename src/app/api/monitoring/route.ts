import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/monitoring
 *
 * Returns monitored projects with their alerts. The previous implementation
 * synthesized a 12-week drift series using `Math.sin(...)` and presented it
 * as real telemetry. That has been removed.
 *
 * TODO(§9.5 of plan): implement real weekly drift snapshots.
 *   1. Add a `WeeklyDriftSnapshot` model with
 *      `(projectId, weekStart, deliveryHours, billedHours, ratio)`.
 *   2. Run a cron/backfill job that populates it from the connectors.
 *   3. Expose the snapshots via this endpoint.
 *
 * Until that lands, `driftSeries` is an empty array and `hasRealDriftData`
 * is false — the UI renders an honest "no data yet" state instead of fake
 * telemetry.
 */
export async function GET() {
  const monitored = await db.monitoredProject.findMany({
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
    },
  })

  const series = monitored.map(m => ({
    monitoredProjectId: m.id,
    projectId: m.project.id,
    projectName: m.project.name,
    clientName: m.project.client.name,
    contractTitle: m.project.contract?.title ?? null,
    baseline: m.driftBaseline ?? 1.0,
    startedAt: m.startedAt,
    alertsEnabled: m.alertsEnabled,
    alerts: m.alerts,
    // Empty until the §9.5 snapshot job lands — do not fake this.
    driftSeries: [],
    hasRealDriftData: false,
  }))

  return NextResponse.json({ ok: true, monitored: series })
}
