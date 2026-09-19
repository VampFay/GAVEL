// GAVEL — provider-flexible rate limiting (production blocker #1 companion).
//
// The ORIGINAL limiter (src/lib/rate-limit.ts) is an in-memory sliding log
// — single-process by design. That remains the dev/test store. This module
// adds a DATABASE-backed store (RateLimitCounter table) so brute-force
// protection:
//   - survives process restarts (an attacker can't reset the counter by
//     waiting for a redeploy), and
//   - is shared when the app ever runs as more than one instance.
//
// Semantics of the DB store: FIXED windows aligned to the epoch
// (windowStart = floor(now/windowMs)·windowMs) with the PREVIOUS window
// weighted by its remaining overlap. This approximates the sliding log
// (an attacker straddling a boundary gets ~max, not 2×max) at the cost of
// one upsert per recorded hit — the same property the in-memory design
// documented as its reason for existing.
//
// Concurrency: upsert(increment) is atomic per row on both SQLite and
// Postgres; the check-then-record TOCTOU gap is bounded exactly as in the
// in-memory design (a few requests over budget at most, immaterial next
// to the 10-attempt budgets in play).
//
// Usage (routes):
//   const status = await checkRateLimit(key, max, windowMs)   // read-only
//   if (!status.allowed) → 429 + Retry-After
//   … on failure: await recordRateLimitHit(key, windowMs)
//
// The memory path delegates to the original rate-limit.ts so its unit
// tests remain the source of truth for that behaviour.

import { db } from './db'
import { getEnv, effectiveRateLimitStore } from './env'
import {
  rateLimitStatus as memoryStatus,
  recordRateLimitHit as memoryRecord,
  clientIpFrom,
} from './rate-limit'

export { clientIpFrom }

export interface RateLimitResult {
  allowed: boolean
  /** Seconds until the oldest counted hit leaves the window (0 when allowed). */
  retryAfterSec: number
}

type StoreDeps = {
  upsertCounter: (key: string, windowStart: Date) => Promise<void>
  readCounters: (key: string, windowStart: Date) => Promise<Array<{ windowStart: Date; count: number }>>
  sweepOld: (cutoff: Date) => Promise<void>
}

/** Injectable for unit tests — defaults to the real Prisma table. */
let deps: StoreDeps = {
  async upsertCounter(key, windowStart) {
    await db.rateLimitCounter.upsert({
      where: { key_windowStart: { key, windowStart } },
      create: { key, windowStart, count: 1 },
      update: { count: { increment: 1 } },
    })
  },
  async readCounters(key, windowStart) {
    const previous = new Date(windowStart.getTime() - 1) // strictly before current window
    return db.rateLimitCounter.findMany({
      where: { key, windowStart: { gte: previous } },
      select: { windowStart: true, count: true },
      orderBy: { windowStart: 'asc' },
    })
  },
  async sweepOld(cutoff) {
    await db.rateLimitCounter.deleteMany({ where: { windowStart: { lt: cutoff } } })
  },
}

export function __setRateLimitStoreDepsForTests(d: StoreDeps | null): void {
  deps = d ?? defaultDeps()
}

function defaultDeps(): StoreDeps {
  return {
    async upsertCounter(key, windowStart) {
      await db.rateLimitCounter.upsert({
        where: { key_windowStart: { key, windowStart } },
        create: { key, windowStart, count: 1 },
        update: { count: { increment: 1 } },
      })
    },
    async readCounters(key, windowStart) {
      const previous = new Date(windowStart.getTime() - 1)
      return db.rateLimitCounter.findMany({
        where: { key, windowStart: { gte: previous } },
        select: { windowStart: true, count: true },
        orderBy: { windowStart: 'asc' },
      })
    },
    async sweepOld(cutoff) {
      await db.rateLimitCounter.deleteMany({ where: { windowStart: { lt: cutoff } } })
    },
  }
}

function storeMode(): 'memory' | 'db' {
  try {
    return effectiveRateLimitStore(getEnv())
  } catch {
    // Env validation failure — the memory store never depends on config.
    return 'memory'
  }
}

/** Fixed-window alignment: the start of the window `now` falls in. */
function windowStartFor(now: number, windowMs: number): Date {
  return new Date(Math.floor(now / windowMs) * windowMs)
}

/**
 * Weighted effective hit count: current window hits in full, previous
 * window hits scaled by how much of it still overlaps the sliding window.
 */
export function effectiveCount(
  now: number,
  windowMs: number,
  current: number,
  previous: number
): number {
  const intoWindow = now % windowMs
  const previousWeight = 1 - intoWindow / windowMs
  return current + previous * previousWeight
}

/** Read-only: would a request on `key` be allowed right now? */
export async function checkRateLimit(
  key: string,
  max: number,
  windowMs: number
): Promise<RateLimitResult> {
  if (storeMode() === 'memory') {
    return memoryStatus(key, max, windowMs)
  }
  const now = Date.now()
  const windowStart = windowStartFor(now, windowMs)
  const rows = await deps.readCounters(key, windowStart)
  let current = 0
  let previous = 0
  for (const r of rows) {
    if (r.windowStart.getTime() === windowStart.getTime()) current = r.count
    else previous = r.count
  }
  const eff = effectiveCount(now, windowMs, current, previous)
  if (eff >= max) {
    // Retry-after: when the weighted count falls below max — dominated by
    // the previous window decaying, else the current window rolling over.
    const decayNeeded = eff - max + 1
    const previousDecay = previous > 0 ? (decayNeeded / previous) * windowMs : Infinity
    const retryMs = Math.min(previousDecay, windowMs - (now % windowMs))
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(retryMs / 1000)) }
  }
  return { allowed: true, retryAfterSec: 0 }
}

/** Write: record an attempt on `key` (call on FAILED attempts / costly calls). */
export async function recordRateLimitHit(key: string, windowMs: number): Promise<void> {
  if (storeMode() === 'memory') {
    memoryRecord(key)
    return
  }
  const now = Date.now()
  const windowStart = windowStartFor(now, windowMs)
  await deps.upsertCounter(key, windowStart)
  // Opportunistic sweep (~5% of writes): keeps the table tiny without a
  // per-hit DELETE. Windows older than an hour can never matter — the
  // largest window in the app is 15 minutes.
  if (Math.random() < 0.05) {
    await deps.sweepOld(new Date(now - 60 * 60_000)).catch(() => {})
  }
}
