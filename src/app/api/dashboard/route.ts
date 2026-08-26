import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { money, sumMoney } from '@/lib/money'

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
  // Money sums accumulate in Decimal.js to avoid IEEE-754 drift, then
  // convert to JS numbers at the end (see src/lib/money.ts). Each finding's
  // impact is also converted via `money()` for storage in the per-type map.
  const nonDismissed: number[] = []
  const approvedImpacts: number[] = []
  let pendingReview = 0
  const typeMap = new Map<string, { count: number; impact: number[] }>()
  const confidenceBuckets = { HIGH: 0, MEDIUM: 0, LOW: 0 }
  const approvedByMonthKey = new Map<string, number[]>()

  for (const f of findings) {
    const dismissed = f.status === 'dismissed'
    const impact = money(f.impactAmount) ?? 0

    if (!dismissed) nonDismissed.push(impact)
    if (f.status === 'approved') {
      approvedImpacts.push(impact)
      // Recovery is dated by when the finding was APPROVED (reviewedAt),
      // not when it was first detected (createdAt).
      const reviewed = f.reviewedAt ? new Date(f.reviewedAt) : null
      if (reviewed) {
        const key = `${reviewed.getFullYear()}-${reviewed.getMonth()}`
        const bucket = approvedByMonthKey.get(key) ?? []
        bucket.push(impact)
        approvedByMonthKey.set(key, bucket)
      }
    }
    if (f.status === 'pending_review') pendingReview++

    const cur = typeMap.get(f.type) ?? { count: 0, impact: [] as number[] }
    cur.count++
    if (!dismissed) cur.impact.push(impact)
    typeMap.set(f.type, cur)

    if (f.confidence === 'HIGH' || f.confidence === 'MEDIUM' || f.confidence === 'LOW') {
      const key: keyof typeof confidenceBuckets = f.confidence
      confidenceBuckets[key]++
    }
  }

  const totalImpact = sumMoney(nonDismissed)
  const approvedImpact = sumMoney(approvedImpacts)

  const findingsByType = Array.from(typeMap.entries()).map(([type, v]) => ({
    type,
    count: v.count,
    impact: sumMoney(v.impact),
  }))

  // Build a 6-month "approved impact by month" series, oldest first.
  // Each month's impact is summed in Decimal.js to avoid drift.
  const recoveryByMonth: { label: string; impact: number }[] = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    const label = d.toLocaleString('en-US', { month: 'short' })
    const bucket = approvedByMonthKey.get(key) ?? []
    recoveryByMonth.push({ label, impact: sumMoney(bucket) })
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
