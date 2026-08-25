import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [findings, audits, monitored, alerts, log] = await Promise.all([
    db.finding.findMany(),
    db.client.findMany({ include: { contracts: { include: { findings: true } } } }),
    db.monitoredProject.count(),
    db.alert.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
    db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 12 }),
  ])

  const totalImpact = findings
    .filter(f => f.status !== 'dismissed')
    .reduce((s, f) => s + (f.impactAmount ?? 0), 0)
  const approvedImpact = findings
    .filter(f => f.status === 'approved')
    .reduce((s, f) => s + (f.impactAmount ?? 0), 0)
  const pendingReview = findings.filter(f => f.status === 'pending_review').length
  const auditedCount = audits.length

  // Findings by type
  const typeMap = new Map<string, { count: number; impact: number }>()
  for (const f of findings) {
    const cur = typeMap.get(f.type) ?? { count: 0, impact: 0 }
    cur.count++
    cur.impact += f.status === 'dismissed' ? 0 : f.impactAmount ?? 0
    typeMap.set(f.type, cur)
  }
  const findingsByType = Array.from(typeMap.entries()).map(([type, v]) => ({
    type,
    count: v.count,
    impact: v.impact,
  }))

  // Confidence distribution
  const confidenceBuckets = {
    HIGH: findings.filter(f => f.confidence === 'HIGH').length,
    MEDIUM: findings.filter(f => f.confidence === 'MEDIUM').length,
    LOW: findings.filter(f => f.confidence === 'LOW').length,
  }

  // Recovery by month (synthetic from findings createdAt + impact)
  const months: { label: string; impact: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - i)
    const label = d.toLocaleString('en-US', { month: 'short' })
    const inMonth = findings.filter(f => {
      const fc = new Date(f.createdAt)
      return fc.getMonth() === d.getMonth() && fc.getFullYear() === d.getFullYear()
    })
    const impact = inMonth
      .filter(f => f.status !== 'dismissed')
      .reduce((s, f) => s + (f.impactAmount ?? 0), 0)
    months.push({ label, impact })
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
    recoveryByMonth: months,
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
