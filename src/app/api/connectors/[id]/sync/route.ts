import { NextRequest } from 'next/server'
import { ok, fail, notFound, withErrorHandler } from '@/lib/api'
import { getRequestId } from '@/lib/actor'
import { requireRole } from '@/lib/auth'
import { db } from '@/lib/db'
import { checkRateLimit, recordRateLimitHit } from '@/lib/rate-limit-store'
import { syncMode, syncQueue } from '@/lib/jobs/queue'
import { runConnectorSync } from '@/lib/jobs/sync-core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/connectors/[id]/sync — pull live evidence from GitHub / Jira.
 *
 * Body (optional): { dryRun?: boolean } — fetch + map + report without writing.
 *
 * WP 1.2 — ASYNCHRONOUS by default: with REDIS_URL configured (or
 * GAVEL_SYNC_MODE=queue) this route only VALIDATES + ENQUEUES and returns
 * 202 { jobId } — the worker process executes the pull + commit, so large
 * repositories and Jira projects can no longer hit the route timeout.
 * Progress: GET /api/connectors/[id]/progress?jobId=… (SSE) or
 * GET /api/connectors/[id]/jobs (polling).
 *
 * Inline fallback (dev without Redis, GAVEL_SYNC_MODE=inline): executes the
 * extracted sync core in-request — the exact same code path the worker runs.
 *
 * Auth: admin. Rate limit: 6 syncs / 5 min per user — every sync costs
 * upstream API budget, so it must not be hammerable.
 */

const SYNC_MAX = 6
const SYNC_WINDOW_MS = 5 * 60_000

export const POST = withErrorHandler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireRole(['admin'])
  const requestId = await getRequestId()
  const { id } = await ctx.params

  const limitKey = `connector-sync:user:${actor.id}`
  const limit = await checkRateLimit(limitKey, SYNC_MAX, SYNC_WINDOW_MS)
  if (!limit.allowed) {
    return Response.json(
      { ok: false, error: 'too many syncs — try again later' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    )
  }
  await recordRateLimitHit(limitKey, SYNC_WINDOW_MS)

  const body = await req.json().catch(() => ({})) as { dryRun?: boolean }
  const dryRun = body?.dryRun === true

  // Tenant-scoped validation BEFORE enqueueing: a cross-tenant connector id
  // is indistinguishable from a missing one, and the job payload must carry
  // the right tenant for the worker's runWithTenant context.
  const connector = await db.connectorSource.findUnique({
    where: { id },
    include: { project: { select: { id: true, tenantId: true } } },
  })
  if (!connector || !connector.project) return notFound('connector not found')
  const tenantId = connector.project.tenantId

  // ── Queue mode: enqueue + 202 ──────────────────────────────────────
  if (!dryRun && syncMode() === 'queue') {
    const queue = syncQueue()
    if (!queue) return fail('queue mode requested but the queue is unavailable', 503)

    const syncJob = await db.syncJob.create({
      data: {
        tenantId,
        connectorId: connector.id,
        status: 'queued',
        requestedBy: actor.email,
        requestId: requestId ?? undefined,
      },
      select: { id: true },
    })

    await queue.add('sync', {
      syncJobId: syncJob.id,
      tenantId,
      connectorId: connector.id,
      actorId: actor.id,
      actorEmail: actor.email,
      requestId,
    }, { jobId: syncJob.id })

    return Response.json(
      {
        ok: true,
        queued: true,
        jobId: syncJob.id,
        mode: 'queue',
        hint: 'watch GET /api/connectors/' + connector.id + '/progress?jobId=' + syncJob.id + ' (SSE)',
      },
      { status: 202 },
    )
  }

  // ── Inline mode (dev / no Redis) + all dryRuns: execute in-request ──
  const result = await runConnectorSync({
    connectorId: connector.id,
    actorId: actor.id,
    actorEmail: actor.email,
    requestId,
    dryRun,
  })
  return ok({ ...result, mode: 'inline' } as unknown as Record<string, unknown>)
})
