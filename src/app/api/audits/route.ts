import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  // "Audits" in this app = the contract+project+findings bundle for a client
  const clients = await db.client.findMany({
    include: {
      contracts: {
        include: {
          lineItems: true,
          changeOrders: true,
          findings: { include: { evidence: true } },
          invoices: { include: { lines: true } },
          projects: {
            include: {
              tickets: true,
              codeActivities: true,
              monitored: { include: { alerts: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const audits = clients.map(c => {
    const contract = c.contracts[0]
    const project = contract?.projects[0]
    const findings = contract?.findings ?? []
    const totalImpact = findings
      .filter(f => f.status !== 'dismissed')
      .reduce((sum, f) => sum + (f.impactAmount ?? 0), 0)
    const approvedImpact = findings
      .filter(f => f.status === 'approved')
      .reduce((sum, f) => sum + (f.impactAmount ?? 0), 0)
    return {
      clientId: c.id,
      clientName: c.name,
      industry: c.industry,
      sizeBand: c.sizeBand,
      contactName: c.contactName,
      contractId: contract?.id ?? null,
      contractTitle: contract?.title ?? null,
      totalValue: contract?.totalValue ?? null,
      currency: contract?.currency ?? 'INR',
      effectiveDate: contract?.effectiveDate ?? null,
      endDate: contract?.endDate ?? null,
      projectId: project?.id ?? null,
      projectName: project?.name ?? null,
      projectStatus: project?.status ?? null,
      findingsCount: findings.length,
      pendingReview: findings.filter(f => f.status === 'pending_review').length,
      approved: findings.filter(f => f.status === 'approved').length,
      dismissed: findings.filter(f => f.status === 'dismissed').length,
      escalated: findings.filter(f => f.status === 'escalated').length,
      totalImpact,
      approvedImpact,
      monitored: !!project?.monitored,
    }
  })

  return NextResponse.json({ ok: true, audits })
}
