import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const monitored = await db.monitoredProject.findMany({
    include: {
      project: {
        include: {
          client: { select: { name: true, id: true } },
          contract: { select: { title: true, totalValue: true, currency: true } },
        },
      },
      alerts: { orderBy: { createdAt: 'desc' } },
    },
  })

  // Build a synthetic 12-week delivery-to-billing drift series per project
  // (in production this would be computed from real weekly snapshots — §9.5)
  const series = monitored.map((m, idx) => {
    const baseline = m.driftBaseline ?? 1.0
    // Each project has a slightly different drift signature
    const seed = (idx + 1) * 0.31
    const points = Array.from({ length: 12 }, (_, i) => {
      const t = i / 11
      // mix of slow rise + a recent spike
      const drift =
        baseline +
        Math.sin(t * 4 + seed) * 0.12 +
        t * 0.22 +
        (i === 10 ? 0.35 : 0) // recent spike
      const noise = (Math.sin(seed * 100 + i) + 1) * 0.04
      return {
        weekLabel: `W${i + 1}`,
        deliveryToBilling: Number(drift.toFixed(3)),
        deliveryHours: Math.round(120 + i * 8 + Math.sin(t * 3 + seed) * 25 + noise * 40),
        billedHours: Math.round(110 + i * 6 + Math.cos(t * 2 + seed) * 22),
      }
    })
    return {
      monitoredProjectId: m.id,
      projectId: m.project.id,
      projectName: m.project.name,
      clientName: m.project.client.name,
      contractTitle: m.project.contract?.title ?? null,
      baseline,
      startedAt: m.startedAt,
      alertsEnabled: m.alertsEnabled,
      alerts: m.alerts,
      driftSeries: points,
    }
  })

  return NextResponse.json({ ok: true, monitored: series })
}
