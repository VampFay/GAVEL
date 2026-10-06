import { NextRequest } from 'next/server'
import { withErrorHandler } from '@/lib/api'
import { requireRole } from '@/lib/auth'
import { db } from '@/lib/db'
import { formatSse, jobSnapshotPayload, isTerminal } from '@/lib/jobs/queue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/connectors/[id]/progress?jobId=… — Server-Sent Events stream of
 * a sync job's state (WP 1.2).
 *
 * Emits:
 *   event: state    — { jobId, status, attempts, error, stats, terminal, … }
 *                     on connect and on every change (read from the durable
 *                     SyncJob row — the queue itself is ephemeral)
 *   : heartbeat     — SSE comment every 15 s (keeps proxies from idling out)
 *
 * Closes when the job reaches a terminal status (completed | failed), the
 * client aborts (req.signal), or 10 minutes elapse (hard cap).
 *
 * Auth: admin; the connector AND the job must belong to the caller's tenant
 * (tenant-scoped reads — a cross-tenant jobId is indistinguishable from a
 * missing one).
 */

const POLL_MS = 750
const HEARTBEAT_MS = 15_000
const MAX_DURATION_MS = 10 * 60_000

export const GET = withErrorHandler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await requireRole(['admin'])
  const { id } = await ctx.params
  const jobId = new URL(req.url).searchParams.get('jobId')

  // Validate the connector belongs to the caller's tenant BEFORE opening
  // the stream (the stream itself re-validates every poll via the scoped
  // SyncJob read — jobId is globally unique, so a cross-tenant job id
  // simply never matches).
  const connector = await db.connectorSource.findUnique({ where: { id }, select: { id: true } })
  if (!connector) {
    return Response.json({ ok: false, error: 'connector not found' }, { status: 404 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const send = (event: string, data: unknown) => {
        if (closed) return
        controller.enqueue(encoder.encode(formatSse({ event, data })))
      }
      const close = () => {
        if (closed) return
        closed = true
        clearInterval(pollTimer)
        clearInterval(heartbeatTimer)
        clearTimeout(capTimer)
        try { controller.close() } catch { /* already closed */ }
      }

      req.signal.addEventListener('abort', close)

      const pollTimer = setInterval(async () => {
        if (closed) return
        try {
          const job = jobId
            ? await db.syncJob.findUnique({
                where: { id: jobId },
                include: { connector: { select: { id: true } } },
              })
            : // No jobId: stream the most recent job for this connector.
              await db.syncJob.findFirst({
                where: { connectorId: id },
                orderBy: { createdAt: 'desc' },
              })
          if (!job || (job as { connectorId?: string }).connectorId !== id) {
            send('state', { jobId, status: 'unknown', terminal: true, error: 'job not found' })
            close()
            return
          }
          send('state', jobSnapshotPayload(job))
          if (isTerminal(job.status)) {
            send('done', jobSnapshotPayload(job))
            close()
          }
        } catch {
          // Transient read error — the next tick retries; do not kill the stream.
        }
      }, POLL_MS)

      const heartbeatTimer = setInterval(() => {
        if (closed) return
        controller.enqueue(encoder.encode(': heartbeat\n\n'))
      }, HEARTBEAT_MS)

      const capTimer = setTimeout(() => {
        send('state', { jobId, status: 'timeout', terminal: true, error: 'stream cap reached (10 min)' })
        close()
      }, MAX_DURATION_MS)

      // Immediate first event so the client renders instantly.
      void (async () => {
        try {
          const job = jobId
            ? await db.syncJob.findUnique({
                where: { id: jobId },
                include: { connector: { select: { id: true } } },
              })
            : await db.syncJob.findFirst({
                where: { connectorId: id },
                orderBy: { createdAt: 'desc' },
              })
          if (job && (job as { connectorId?: string }).connectorId === id) {
            send('state', jobSnapshotPayload(job))
            if (isTerminal(job.status)) {
              send('done', jobSnapshotPayload(job))
              close()
            }
          } else if (!job) {
            send('state', { jobId, status: 'unknown', terminal: true, error: 'no jobs yet' })
          }
        } catch { /* first-poll failure tolerated */ }
      })()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
})
