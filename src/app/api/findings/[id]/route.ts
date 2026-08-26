import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const finding = await db.finding.findUnique({
    where: { id },
    include: {
      evidence: { orderBy: { weight: 'desc' } },
      project: true,
      contract: true,
    },
  })
  if (!finding) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, finding })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const { action, reviewNotes, actor } = body as {
    action: 'approve' | 'dismiss' | 'escalate'
    reviewNotes?: string
    actor?: string
  }

  const statusMap = {
    approve: 'approved',
    dismiss: 'dismissed',
    escalate: 'escalated',
  } as const

  if (!(action in statusMap)) {
    return NextResponse.json(
      { ok: false, error: 'invalid action' },
      { status: 400 }
    )
  }

  const updated = await db.finding.update({
    where: { id },
    data: {
      status: statusMap[action],
      reviewedAt: new Date(),
      reviewedBy: actor ?? 'reviewer@shipledger',
      reviewNotes: reviewNotes ?? null,
    },
  })

  await db.auditLog.create({
    data: {
      actor: actor ?? 'reviewer@shipledger',
      action,
      entityType: 'finding',
      entityId: id,
      detail: reviewNotes ?? `Finding ${action}ed`,
    },
  })

  return NextResponse.json({ ok: true, finding: updated })
}
