import { db } from '@/lib/db'
import { ok } from '@/lib/api'

export const dynamic = 'force-dynamic'

/**
 * GET /api/audits
 *
 * Returns the audit summary list (one row per client). The previous
 * implementation eagerly loaded depth-5 relations (clients→contracts→
 * {lineItems, changeOrders, findings→evidence, invoices→lines,
 * projects→{tickets, codeActivities, monitored→alerts}}) and returned
 * contactName PII to anyone — no auth.
 *
 * Performance fixes:
 *   - Single `reduce` pass per client (was 6 filter+reduce scans).
 *   - `select` on Finding to skip `summary`, `reviewNotes`, etc.
 *   - No relation eager-loading beyond what's needed for the summary
 *     (no evidence, no invoices, no codeActivities, no alerts).
 *
 * PII fix:
 *   - Drop `contactName` from the public response. Will be re-added
 *     when auth is wired (per the §10 plan) and only for callers with
 *     a `reviewer` or `admin` role.
 */
export async function GET() {
  const clients = await db.client.findMany({
    select: {
      id: true,
      name: true,
      industry: true,
      sizeBand: true,
      createdAt: true,
      contracts: {
        select: {
          id: true,
          title: true,
          totalValue: true,
          currency: true,
          effectiveDate: true,
          endDate: true,
          projects: { select: { id: true, name: true, status: true, monitored: true } },
          findings: {
            select: {
              id: true,
              status: true,
              impactAmount: true,
            },
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const audits = clients.map(c => {
    const contract = c.contracts[0]
    const project = contract?.projects[0]
    const findings = contract?.findings ?? []

    // Single reduce pass over findings for this client.
    let totalImpact = 0
    let approvedImpact = 0
    let pendingReview = 0
    let approved = 0
    let dismissed = 0
    let escalated = 0
    for (const f of findings) {
      const impact = f.impactAmount ?? 0
      if (f.status !== 'dismissed') totalImpact += impact
      if (f.status === 'approved') {
        approvedImpact += impact
        approved++
      } else if (f.status === 'pending_review') {
        pendingReview++
      } else if (f.status === 'dismissed') {
        dismissed++
      } else if (f.status === 'escalated') {
        escalated++
      }
    }

    return {
      clientId: c.id,
      clientName: c.name,
      industry: c.industry,
      sizeBand: c.sizeBand,
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
      pendingReview,
      approved,
      dismissed,
      escalated,
      totalImpact,
      approvedImpact,
      monitored: !!project?.monitored,
    }
  })

  return ok({ audits })
}
