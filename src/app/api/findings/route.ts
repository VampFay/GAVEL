import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const findings = await db.finding.findMany({
    include: { evidence: true, project: true, contract: true },
    orderBy: [{ confidence: 'desc' }, { impactAmount: 'desc' }],
  })
  return NextResponse.json({ ok: true, findings })
}
