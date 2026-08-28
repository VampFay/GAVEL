import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/monitoring
 *
 * Returns monitored projects with their alerts and weekly drift series.
 *
 * driftSeries is built from REAL WeeklyDriftSnapshot rows. Nothing here is
 * synthesized — the previous implementation faked a 12-week drift series
 * with `Math.sin(...)` and presented it as telemetry; that was removed.
 * No snapshot writer exists yet (the §9.5 weekly job lands with the
 * connector phase), so today every project returns an empty series with
 * hasRealDriftData: false, and the UI renders an honest "no data yet"
 * state. When the job lands, the charts light up with zero changes here.
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
      // Real snapshot rows, oldest → newest for charting. Take the last 12
      // weeks (the §9.5 window); ascending order after the desc fetch.
      driftSnapshots: { orderBy: { weekStart: 'desc' }, take: 12 },
    },
  })

  const series = monitored.map(m => {
    const driftSeries = [...m.driftSnapshots]
      .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime())
      .map(s => ({
        weekLabel: s.weekStart.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        deliveryToBilling: s.ratio,
        deliveryHours: s.deliveryHours,
        billedHours: s.billedHours,
      }))

    return {
      monitoredProjectId: m.id,
      projectId: m.project.id,
      projectName: m.project.name,
      clientName: m.project.client.name,
      contractTitle: m.project.contract?.title ?? null,
      baseline: m.driftBaseline ?? 1.0,
      startedAt: m.startedAt,
      alertsEnabled: m.alertsEnabled,
      alerts: m.alerts,
      // Real data only — never synthesized (see header comment).
      driftSeries,
      hasRealDriftData: driftSeries.length > 0,
    }
  })

  return NextResponse.json({ ok: true, monitored: series })
}
