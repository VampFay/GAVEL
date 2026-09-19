import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  effectiveCount,
  __setRateLimitStoreDepsForTests,
} from '../../src/lib/rate-limit-store'
import { resetRateLimits } from '../../src/lib/rate-limit'

vi.useFakeTimers()

// ── Pure math ───────────────────────────────────────────────────────────────

describe('effectiveCount (weighted two-window sliding approximation)', () => {
  const W = 60_000

  it('counts the current window in full', () => {
    expect(effectiveCount(Date.now(), W, 5, 0)).toBe(5)
  })

  it('weights the previous window by remaining overlap', () => {
    const t = Math.floor(Date.now() / W) * W + 30_000
    expect(effectiveCount(t, W, 0, 4)).toBe(2)
  })

  it('previous window decays to (effectively) zero at the boundary', () => {
    const t = Math.floor(Date.now() / W) * W + 60_000 - 1
    // 1ms before rollover: weight = 1ms/60s → 10 hits contribute < 0.01.
    expect(effectiveCount(t, W, 0, 10)).toBeLessThan(0.01)
  })

  it('a boundary-straddling burst stays bounded (not 2x max)', () => {
    const base = Math.floor(Date.now() / W) * W
    // Midpoint peak: max in the previous + max in the current window
    // counts at 1.5x — materially below the naive fixed-window 2x burst.
    expect(effectiveCount(base + 30_000, W, 10, 10)).toBe(15)
    // Late in the window the old weight has decayed to ~1.
    expect(effectiveCount(base + 54_000, W, 10, 10)).toBe(11)
  })
})

// ── DB store upsert/read contract with an injected fake ─────────────────────

interface Row { windowStart: Date; count: number }

function makeKeyedFakeStore(windowMs: number) {
  const rows = new Map<string, Row>()
  return {
    rows,
    deps: {
      async upsertCounter(key: string, windowStart: Date) {
        const k = `${key}@${windowStart.getTime()}`
        const existing = rows.get(k)
        if (existing) existing.count += 1
        else rows.set(k, { windowStart, count: 1 })
      },
      async readCounters(key: string, windowStart: Date) {
        const prevStart = new Date(Math.floor(windowStart.getTime() / windowMs) * windowMs - windowMs)
        const curr = rows.get(`${key}@${windowStart.getTime()}`)
        const prev = rows.get(`${key}@${prevStart.getTime()}`)
        return [...(prev ? [prev] : []), ...(curr ? [curr] : [])]
      },
      async sweepOld() { /* no-op for tests */ },
    },
  }
}

beforeEach(() => {
  resetRateLimits()
  __setRateLimitStoreDepsForTests(null)
  vi.setSystemTime(new Date('2026-01-01T00:00:30Z')) // 30s into a window
})

describe('db-mode fixed windows (injected fake store)', () => {
  it('upsert increments the (key, window) counter and reads it back', async () => {
    const store = makeKeyedFakeStore(60_000)
    const windowStart = new Date(Math.floor(Date.now() / 60_000) * 60_000)
    await store.deps.upsertCounter('k', windowStart)
    await store.deps.upsertCounter('k', windowStart)
    const rows = await store.deps.readCounters('k', windowStart)
    expect(rows.find(r => r.windowStart.getTime() === windowStart.getTime())?.count).toBe(2)
  })

  it('reads span exactly the current + previous window', async () => {
    const store = makeKeyedFakeStore(60_000)
    const W = 60_000
    const currStart = new Date(Math.floor(Date.now() / W) * W)
    const prevStart = new Date(currStart.getTime() - W)
    await store.deps.upsertCounter('k', prevStart)
    await store.deps.upsertCounter('k', currStart)
    const rows = await store.deps.readCounters('k', currStart)
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.count)).toEqual([1, 1])
  })

  it('weighted count unblocks as the previous window decays', () => {
    const W = 60_000
    const base = Math.floor(Date.now() / W) * W
    // 3 hits in previous window, 0 current, 45s in: 0 + 3x0.25 < 2 → allowed.
    expect(effectiveCount(base + 45_000, W, 0, 3)).toBeLessThan(2)
    // 15s in: 0 + 3x0.75 = 2.25 >= 2 → still blocked.
    expect(effectiveCount(base + 15_000, W, 0, 3)).toBeGreaterThanOrEqual(2)
  })
})
