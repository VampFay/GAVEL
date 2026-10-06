// GAVEL — connector-sync worker processor (WP 1.2).
//
// Executes one queue job: mark the SyncJob active → run the extracted sync
// core inside the job's tenant context (runWithTenant establishes the ALS
// context that scopes every db.* call, incl. the RLS GUC on PostgreSQL) →
// record the outcome. BullMQ handles retries with exponential backoff; the
// processor marks failures as final only when they are permanent (deleted
// connector, missing credentials) — transient upstream errors (timeouts,
// 5xx, rate limits) stay retriable, and syncs are idempotent (the commit
// layer dedupes), so a partially-completed retry is always safe.

import { db } from '@/lib/db'
import { systemDb } from '@/lib/db-system'
import { runWithTenant } from '@/lib/tenant-context'
import { runConnectorSync } from './sync-core'
import type { SyncJobPayload } from './queue'

/** Error attached to jobs that must NOT be retried (bad config, not transient). */
export class NonRetryableSyncError extends Error {}

export async function processSyncJob(payload: SyncJobPayload): Promise<unknown> {
  const { syncJobId, tenantId, connectorId, actorId, actorEmail, requestId } = payload

  // The worker has no request context — establish the tenant for every
  // scoped operation this sync performs (app-layer where-injection AND the
  // PostgreSQL RLS GUC both key off this).
  return runWithTenant(tenantId, async () => {
    await db.syncJob.update({
      where: { id: syncJobId },
      data: { status: 'active', startedAt: new Date() },
    })

    try {
      const result = await runConnectorSync({ connectorId, actorId, actorEmail, requestId })

      await db.syncJob.update({
        where: { id: syncJobId },
        data: {
          status: 'completed',
          finishedAt: new Date(),
          stats: JSON.stringify({
            fetched: result.fetched,
            committed: result.committed ?? null,
          }),
          error: null,
        },
      })
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const status = (err as { status?: number }).status
      // 404 (connector deleted) and 409 (missing credentials) are
      // permanent — retrying cannot fix them.
      const permanent = status === 404 || status === 409 || err instanceof NonRetryableSyncError
      await db.syncJob.update({
        where: { id: syncJobId },
        data: {
          status: permanent ? 'failed' : 'active', // transient: stays active until next attempt
          error: message.slice(0, 500),
          finishedAt: permanent ? new Date() : null,
        },
      })
      if (permanent) throw new NonRetryableSyncError(message)
      throw err
    }
  })
}

/**
 * Final-failure bookkeeping: BullMQ exhausted the attempts. Runs in the
 * worker's trusted process context — the system (owner) client is correct
 * here (cross-tenant by design, like every other system maintenance path).
 */
export async function markSyncJobExhausted(syncJobId: string, error: string): Promise<void> {
  await systemDb.syncJob.update({
    where: { id: syncJobId },
    data: { status: 'failed', error: error.slice(0, 500), finishedAt: new Date() },
  })
}
