// GAVEL — BullMQ queue for asynchronous connector syncs (WP 1.2).
//
// The API route enqueues; a separate worker process (scripts/run-worker.ts,
// `bun run worker`) executes. SyncJob (Prisma) is the durable mirror of the
// ephemeral queue job and the single source of truth for progress reporting
// — the SSE route and the polling endpoint both read it, never Redis.
//
// Execution mode resolution (syncMode()):
//   GAVEL_SYNC_MODE=queue | inline   — explicit override
//   otherwise: REDIS_URL set → queue; unset → inline (dev convenience —
//   the same code path, just executed in the request)

import { Queue, Worker, type JobsOptions, type ConnectionOptions } from 'bullmq'
import { parse } from 'node:url'

export const SYNC_QUEUE = 'connector-sync'

export function redisUrl(): string | null {
  const url = process.env.REDIS_URL
  if (!url || !/^redis(s)?:\/\//.test(url)) return null
  return url
}

export type SyncMode = 'queue' | 'inline'

export function syncMode(): SyncMode {
  const explicit = process.env.GAVEL_SYNC_MODE
  if (explicit === 'queue' || explicit === 'inline') return explicit
  return redisUrl() ? 'queue' : 'inline'
}

/** Parse REDIS_URL into BullMQ's ConnectionOptions (host/port/username/password/tls). */
export function connectionOptions(url = redisUrl()): ConnectionOptions {
  if (!url) return {}
  const u = new URL(url)
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password || undefined,
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
  }
}

/**
 * Retry policy: 5 attempts, exponential backoff starting at 2 s.
 * delay(n) = 2^n s → 2 s, 4 s, 8 s, 16 s (32 s total worst-case wait,
 * capped by BullMQ's internal jitter). Syncs are idempotent (commit layer
 * dedupes), so retrying a partially-completed sync is always safe.
 */
export const SYNC_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 3_600, count: 200 },
  removeOnFail: { age: 86_400 },
}

/** Backoff delay for attempt n (1-based), seconds — exported for tests. */
export function backoffDelaySec(attempt: number, baseMs = 2_000): number {
  return Math.pow(2, Math.max(0, attempt - 1)) * (baseMs / 1000)
}

export interface SyncJobPayload {
  /** SyncJob row id — the durable handle the SSE route reports on. */
  syncJobId: string
  tenantId: string
  connectorId: string
  actorId: string
  actorEmail: string
  requestId?: string | null
}

const globalForQueue = globalThis as unknown as {
  gavelSyncQueue: Queue<SyncJobPayload> | undefined
}

/** Process-wide singleton queue (API routes import this). */
export function syncQueue(): Queue<SyncJobPayload> | null {
  if (syncMode() !== 'queue') return null
  globalForQueue.gavelSyncQueue ??= new Queue<SyncJobPayload>(SYNC_QUEUE, {
    connection: connectionOptions(),
    defaultJobOptions: SYNC_JOB_OPTIONS,
  })
  return globalForQueue.gavelSyncQueue
}

// ── SyncJob status state machine (pure — unit tested) ─────────────────────

export type SyncJobStatus = 'queued' | 'active' | 'completed' | 'failed'

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['completed', 'failed'])

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status)
}

/** Legal transitions — guards the worker against out-of-order updates. */
const TRANSITIONS: Record<string, ReadonlySet<string>> = {
  queued: new Set(['active', 'failed']),
  active: new Set(['completed', 'failed', 'active']), // active→active: attempt bump
  completed: new Set(),
  failed: new Set(['queued']), // re-enqueued manual retry
}

export function canTransition(from: string, to: string): boolean {
  return TRANSITIONS[from]?.has(to) ?? false
}

// ── SSE event formatting (pure — unit tested) ─────────────────────────────

export interface SseEvent {
  event: string
  data: unknown
}

export function formatSse(e: SseEvent): string {
  return `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`
}

export interface SyncJobSnapshot {
  id: string
  status: string
  attempts: number
  error: string | null
  stats: string | null
  startedAt: Date | null
  finishedAt: Date | null
}

/** The payload the SSE route streams and the polling endpoint returns. */
export function jobSnapshotPayload(s: SyncJobSnapshot) {
  let stats: unknown = null
  if (s.stats) {
    try { stats = JSON.parse(s.stats) } catch { stats = null }
  }
  return {
    jobId: s.id,
    status: s.status,
    attempts: s.attempts,
    error: s.error,
    stats,
    startedAt: s.startedAt?.toISOString() ?? null,
    finishedAt: s.finishedAt?.toISOString() ?? null,
    terminal: isTerminal(s.status),
  }
}

// ── Worker factory (used by scripts/run-worker.ts AND integration tests) ──

export interface WorkerHooks {
  /** Invoked with the sync result on success (tests assert on this). */
  onCompleted?: (syncJobId: string, result: unknown) => void
  /** Invoked when attempts are exhausted (or a non-retryable failure). */
  onFailed?: (syncJobId: string, error: string, final: boolean) => void
}

export function createSyncWorker(
  process: (payload: SyncJobPayload) => Promise<unknown>,
  connection: ConnectionOptions = connectionOptions(),
  hooks: WorkerHooks = {},
): Worker<SyncJobPayload> {
  return new Worker<SyncJobPayload>(
    SYNC_QUEUE,
    async job => {
      const { syncJobId } = job.data
      try {
        const result = await process(job.data)
        hooks.onCompleted?.(syncJobId, result)
        return result
      } catch (err) {
        const final = job.attemptsMade >= (job.opts.attempts ?? 1) - 1
        hooks.onFailed?.(syncJobId, err instanceof Error ? err.message : String(err), final)
        throw err
      }
    },
    { connection, concurrency: 2 },
  )
}
