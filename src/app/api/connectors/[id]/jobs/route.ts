import { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api'
import { requireRole } from '@/lib/auth'
import { db } from '@/lib/db'
import { jobSnapshotPayload } from '@/lib/jobs/queue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/connectors/[id]/jobs?limit=10 — recent sync jobs for a connector
 * (WP 1.2 polling endpoint; the SSE route is the primary progress channel,
 * this covers environments where EventSource is unavailable).
 *
 * Tenant-scoped: the connector read is scoped first, and the SyncJob list
 * is scoped to the caller's tenant AND that connector.
 */
export const GET = withErrorHandler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await requireRole(['admin'])
  const { id } = await ctx.params
  const limitRaw = Number(new URL(req.url).searchParams.get('limit') ?? '10')
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 10, 1), 50)

  // Scoped connector read — 404 for cross-tenant ids.
  const connector = await db.connectorSource.findUnique({ where: { id }, select: { id: true } })
  if (!connector) return NextResponse.json({ ok: false, error: 'connector not found' }, { status: 404 })

  const jobs = await db.syncJob.findMany({
    where: { connectorId: id },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return NextResponse.json({ ok: true, jobs: jobs.map(jobSnapshotPayload) })
})
