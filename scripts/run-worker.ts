#!/usr/bin/env bun
// GAVEL — connector-sync worker entrypoint (WP 1.2).
//
//   bun run worker        (package script)
//
// Runs alongside the web server in queue mode (REDIS_URL set): consumes
// the connector-sync queue, executes the sync core with exponential-backoff
// retries, and keeps the durable SyncJob rows current. The web process
// NEVER executes syncs in queue mode — route timeouts can no longer kill a
// large repository pull.
//
// Graceful shutdown: SIGTERM/SIGINT drain the worker (BullMQ closes the
// queue connection after in-flight jobs finish).

import { createSyncWorker, redisUrl, syncQueue } from '../src/lib/jobs/queue'
import { processSyncJob, markSyncJobExhausted } from '../src/lib/jobs/worker-processor'

async function main() {
  if (!redisUrl()) {
    console.error(
      '❌ REDIS_URL is not set — the worker only runs in queue mode.\n' +
      '   Start Redis (docker compose up -d gavel-redis) and set REDIS_URL,\n' +
      '   or run the API with GAVEL_SYNC_MODE=inline for dev.'
    )
    process.exit(1)
  }

  console.log(`[worker] queue mode — consuming ${'connector-sync'} on ${redisUrl()}`)

  const worker = createSyncWorker(processSyncJob, undefined, {
    onFailed: (syncJobId, error, final) => {
      if (final) {
        console.warn(`[worker] sync ${syncJobId} FAILED (attempts exhausted): ${error}`)
        void markSyncJobExhausted(syncJobId, error)
      } else {
        console.warn(`[worker] sync ${syncJobId} attempt failed (will retry): ${error}`)
      }
    },
  })

  worker.on('completed', job => {
    console.log(`[worker] sync ${job.data.syncJobId} completed`)
  })
  worker.on('error', err => {
    console.error('[worker] worker error:', err.message)
  })

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} — draining`)
    await worker.close()
    const q = syncQueue()
    if (q) await q.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch(e => {
  console.error('[worker] fatal:', e)
  process.exit(1)
})
