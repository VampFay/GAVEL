import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/dashboard
 *
 * Returns KPIs, breakdowns, recent alerts, and recent activity for the
 * dashboard landing view.
 *
 * Performance notes:
 *   - Uses `select` to avoid pulling `summary`, `reviewNotes`,
 *     `contractClause`, `billingState` (potentially large) on every row.
 *   - Single in-memory reduce pass over `findings` instead of six scans.
 *   - `auditedCount` is now `db.client.count()` instead of pulling the
 *     entire client+contract+findings tree just to call `.length`.
 *
 * `recoveryByMonth` is computed from `Finding.reviewedAt` where
 * `status === 'approved'` — i.e. money actually approved for recovery by a
 * reviewer. The previous implementation used `createdAt` of all non-dismissed
 * findings, which conflated "issue detected" with "money recovered".
 */
export async function GET() {
  const [findings, auditedCount, monitored, alerts, log] = await Promise.all([
    db.finding.findMany({
      select: {
        id: true,
        type: true,
        status: true,
        confidence: true,
        confidenceScore: true,
        impactAmount: true,
        createdAt: true,
        reviewedAt: true,
      },
    }),
    db.client.count(),
    db.monitoredProject.count(),
    db.alert.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
    db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 12 }),
  ])

  // Single reduce pass over findings.
  let totalImpact = 0
  let approvedImpact = 0
  let pendingReview = 0
  const typeMap = new Map<string, { count: number; impact: number }>()
  const confidenceBuckets = { HIGH: 0, MEDIUM: 0, LOW: 0 }
  const approvedByMonthKey = new Map<string, number>()

  for (const f of findings) {
    const dismissed = f.status === 'dismissed'
    const impact = f.impactAmount ?? 0

    if (!dismissed) totalImpact += impact
    if (f.status === 'approved') {
      approvedImpact += impact
      // Recovery is dated by when the finding was APPROVED (reviewedAt),
      // not when it was first detected (createdAt).
      const reviewed = f.reviewedAt ? new Date(f.reviewedAt) : null
      if (reviewed) {
        const key = `${reviewed.getFullYear()}-${reviewed.getMonth()}`
        approvedByMonthKey.set(key, (approvedByMonthKey.get(key) ?? 0) + impact)
      }
    }
    if (f.status === 'pending_review') pendingReview++

    const cur = typeMap.get(f.type) ?? { count: 0, impact: 0 }
    cur.count++
    cur.impact += dismissed ? 0 : impact
    typeMap.set(f.type, cur)

    if (f.confidence === 'HIGH' || f.confidence === 'MEDIUM' || f.confidence === 'LOW') {
      confidenceBuckets[f.confidence]++
    }
  }

  const findingsByType = Array.from(typeMap.entries()).map(([type, v]) => ({
    type,
    count: v.count,
    impact: v.impact,
  }))

  // Build a 6-month "approved impact by month" series, oldest first.
  const recoveryByMonth: { label: string; impact: number }[] = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    const label = d.toLocaleString('en-US', { month: 'short' })
    recoveryByMonth.push({ label, impact: approvedByMonthKey.get(key) ?? 0 })
  }

  return NextResponse.json({
    ok: true,
    kpis: {
      totalImpact,
      approvedImpact,
      pendingReview,
      auditedCount,
      monitoredProjects: monitored,
      totalFindings: findings.length,
    },
    findingsByType,
    confidenceBuckets,
    recoveryByMonth,
    recentAlerts: alerts,
    recentActivity: log.map(l => ({
      id: l.id,
      actor: l.actor,
      action: l.action,
      detail: l.detail,
      createdAt: l.createdAt,
    })),
  })
}
