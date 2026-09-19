import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withErrorHandler } from '@/lib/api'
import { money } from '@/lib/money'
import { parseConfidenceBreakdown } from '@/lib/engine/confidence'

export const dynamic = 'force-dynamic'

export const GET = withErrorHandler(
  async (
    _req: NextRequest,
    { params }: { params: Promise<{ clientId: string }> }
  ) => {
  const { clientId } = await params
  const client = await db.client.findUnique({
    where: { id: clientId },
    include: {
      contracts: {
        include: {
          lineItems: true,
          changeOrders: true,
          findings: {
            orderBy: [{ confidence: 'desc' }, { impactAmount: 'desc' }],
          },
          invoices: { include: { lines: true } },
          projects: {
            include: {
              tickets: { orderBy: { externalUpdated: 'desc' }, take: 100 },
              codeActivities: { orderBy: { timestamp: 'desc' }, take: 100 },
              monitored: true,
            },
          },
        },
      },
    },
  })
  if (!client) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })

  const contract = client.contracts[0]
  const project = contract?.projects[0]
  if (!contract || !project) {
    return NextResponse.json({ ok: false, error: 'no contract/project' }, { status: 404 })
  }

  // Convert Decimal money fields → numbers at the response boundary.
  // Prisma.Decimal would otherwise serialize as a string (the safest
  // JSON transport for money) but the existing client code expects
  // `number` — see src/lib/money.ts.
  return NextResponse.json({
    ok: true,
    client: {
      id: client.id,
      name: client.name,
      industry: client.industry,
      sizeBand: client.sizeBand,
      // NOTE: contactName + contactEmail intentionally omitted on this
      // any-role GET (PII exposure — see audit P0/P1). Re-add behind
      // requireRole(['reviewer','admin']) when the UI needs contact details.
    },
    contract: {
      id: contract.id,
      title: contract.title,
      rawText: contract.rawText,
      extractedJson: contract.extractedJson,
      effectiveDate: contract.effectiveDate,
      endDate: contract.endDate,
      totalValue: money(contract.totalValue),
      currency: contract.currency,
      lineItems: contract.lineItems.map(li => ({
        ...li,
        rate: money(li.rate),
      })),
      changeOrders: contract.changeOrders.map(co => ({
        ...co,
        value: money(co.value),
      })),
      invoices: contract.invoices.map(inv => ({
        ...inv,
        total: money(inv.total),
        lines: inv.lines.map(line => ({
          ...line,
          amount: money(line.amount),
        })),
      })),
      findings: contract.findings.map(f => ({
        ...f,
        impactAmount: money(f.impactAmount),
        confidenceBreakdown: parseConfidenceBreakdown(f.confidenceBreakdown),
      })),
    },
    project: {
      id: project.id,
      name: project.name,
      status: project.status,
      startDate: project.startDate,
      endDate: project.endDate,
      tickets: project.tickets,
      codeActivities: project.codeActivities,
      monitored: project.monitored,
    },
  })
})
