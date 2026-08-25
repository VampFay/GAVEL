import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
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
              tickets: { orderBy: { updated: 'desc' } },
              codeActivities: { orderBy: { timestamp: 'desc' } },
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

  return NextResponse.json({
    ok: true,
    client: {
      id: client.id,
      name: client.name,
      industry: client.industry,
      sizeBand: client.sizeBand,
      contactName: client.contactName,
      contactEmail: client.contactEmail,
    },
    contract: {
      id: contract.id,
      title: contract.title,
      rawText: contract.rawText,
      extractedJson: contract.extractedJson,
      effectiveDate: contract.effectiveDate,
      endDate: contract.endDate,
      totalValue: contract.totalValue,
      currency: contract.currency,
      lineItems: contract.lineItems,
      changeOrders: contract.changeOrders,
      invoices: contract.invoices,
      findings: contract.findings,
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
}
