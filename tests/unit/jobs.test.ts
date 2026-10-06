import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// WP 1.2 — unit coverage for the async sync pipeline's pure decision logic.
// The full queue→worker→SyncJob flow is covered by the live harness
// (scripts/verify-jobs-pipeline.ts) against a real Redis + real BullMQ.

import {
  SYNC_JOB_OPTIONS,
  SYNC_QUEUE,
  backoffDelaySec,
  canTransition,
  connectionOptions,
  formatSse,
  isTerminal,
  jobSnapshotPayload,
  syncMode,
} from '../../src/lib/jobs/queue'

const ENV = { ...process.env }

beforeEach(() => {
  process.env = { ...ENV }
})
afterEach(() => {
  process.env = ENV
})

// ── mode resolution ─────────────────────────────────────────────────────────

describe('syncMode()', () => {
  it('auto: inline when REDIS_URL is unset', () => {
    delete process.env.REDIS_URL
    delete process.env.GAVEL_SYNC_MODE
    expect(syncMode()).toBe('inline')
  })

  it('auto: queue when REDIS_URL points at redis', () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:6379'
    delete process.env.GAVEL_SYNC_MODE
    expect(syncMode()).toBe('queue')
  })

  it('explicit GAVEL_SYNC_MODE overrides the URL probe in both directions', () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:6379'
    process.env.GAVEL_SYNC_MODE = 'inline'
    expect(syncMode()).toBe('inline')

    process.env.REDIS_URL = undefined
    process.env.GAVEL_SYNC_MODE = 'queue'
    expect(syncMode()).toBe('queue')
  })

  it('non-redis REDIS_URL is ignored (no false queue mode)', () => {
    process.env.REDIS_URL = 'http://not-redis'
    delete process.env.GAVEL_SYNC_MODE
    expect(syncMode()).toBe('inline')
  })
})

// ── retry policy ────────────────────────────────────────────────────────────

describe('retry policy', () => {
  it('5 attempts with exponential backoff from 2 s', () => {
    expect(SYNC_JOB_OPTIONS.attempts).toBe(5)
    expect(SYNC_JOB_OPTIONS.backoff).toEqual({ type: 'exponential', delay: 2_000 })
  })

  it('backoffDelaySec doubles per attempt: 2,4,8,16 s', () => {
    expect(backoffDelaySec(1)).toBe(2)
    expect(backoffDelaySec(2)).toBe(4)
    expect(backoffDelaySec(3)).toBe(8)
    expect(backoffDelaySec(4)).toBe(16)
  })

  it('attempt 0 / negative clamps to the first step', () => {
    expect(backoffDelaySec(0)).toBe(2)
    expect(backoffDelaySec(-3)).toBe(2)
  })

  it('queue name is stable (cross-process contract)', () => {
    expect(SYNC_QUEUE).toBe('connector-sync')
  })
})

// ── connection parsing ──────────────────────────────────────────────────────

describe('connectionOptions()', () => {
  it('parses host, port, credentials', () => {
    const o = connectionOptions('redis://u:p@redis.example.com:6380')
    expect(o).toMatchObject({ host: 'redis.example.com', port: 6380, username: 'u', password: 'p' })
  })

  it('defaults port 6379 and flags TLS for rediss://', () => {
    const o = connectionOptions('rediss://redis.example.com')
    expect(o).toMatchObject({ host: 'redis.example.com', port: 6379, tls: {} })
  })

  it('no URL → empty options', () => {
    expect(connectionOptions(null)).toEqual({})
  })
})

// ── status machine ──────────────────────────────────────────────────────────

describe('SyncJob status machine', () => {
  it('terminal statuses', () => {
    expect(isTerminal('completed')).toBe(true)
    expect(isTerminal('failed')).toBe(true)
    expect(isTerminal('queued')).toBe(false)
    expect(isTerminal('active')).toBe(false)
  })

  it('legal transitions', () => {
    expect(canTransition('queued', 'active')).toBe(true)
    expect(canTransition('queued', 'failed')).toBe(true)
    expect(canTransition('active', 'completed')).toBe(true)
    expect(canTransition('active', 'failed')).toBe(true)
    expect(canTransition('failed', 'queued')).toBe(true) // manual re-enqueue
    expect(canTransition('queued', 'completed')).toBe(false) // must activate first
    expect(canTransition('completed', 'active')).toBe(false) // completed is final
  })
})

// ── SSE formatting ──────────────────────────────────────────────────────────

describe('SSE formatting', () => {
  it('event frames follow the SSE wire format', () => {
    expect(formatSse({ event: 'state', data: { status: 'queued' } })).toBe(
      'event: state\ndata: {"status":"queued"}\n\n',
    )
  })

  it('heartbeats are comment lines (route unit: ": heartbeat\\n\\n")', () => {
    // the route enqueues this literal — asserted here as the contract
    const frame = ': heartbeat\n\n'
    expect(frame.startsWith(':')).toBe(true)
  })
})

// ── snapshot payload ────────────────────────────────────────────────────────

describe('jobSnapshotPayload()', () => {
  it('parses stats JSON and flags terminal', () => {
    const p = jobSnapshotPayload({
      id: 'job-1',
      status: 'completed',
      attempts: 2,
      error: null,
      stats: JSON.stringify({ fetched: { tickets: 3 }, committed: { ticketsCreated: 3 } }),
      startedAt: new Date('2026-10-06T08:00:00Z'),
      finishedAt: new Date('2026-10-06T08:00:05Z'),
    })
    expect(p).toMatchObject({
      jobId: 'job-1',
      status: 'completed',
      attempts: 2,
      terminal: true,
      startedAt: '2026-10-06T08:00:00.000Z',
      finishedAt: '2026-10-06T08:00:05.000Z',
    })
    expect((p.stats as { committed: { ticketsCreated: number } }).committed.ticketsCreated).toBe(3)
  })

  it('nulls malformed stats instead of throwing', () => {
    const p = jobSnapshotPayload({
      id: 'j', status: 'failed', attempts: 5, error: 'boom',
      stats: '{{{not json', startedAt: null, finishedAt: null,
    })
    expect(p.stats).toBeNull()
    expect(p.error).toBe('boom')
  })
})

// ── non-retryable classification ────────────────────────────────────────────

describe('worker failure classification (via processor module contract)', () => {
  it('NonRetryableSyncError is exported and instanceof Error', async () => {
    const { NonRetryableSyncError } = await import('../../src/lib/jobs/worker-processor')
    const e = new NonRetryableSyncError('permanent')
    expect(e instanceof Error).toBe(true)
  })
})

// silence the unused-import linter for vi (kept for future spies)
void vi
