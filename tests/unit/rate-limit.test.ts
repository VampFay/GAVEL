import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  rateLimitStatus,
  recordRateLimitHit,
  resetRateLimits,
  clientIpFrom,
} from '../../src/lib/rate-limit'

// The limiter is wall-clock based; fake timers keep the tests hermetic.
vi.useFakeTimers()

beforeEach(() => {
  resetRateLimits()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
})

describe('rateLimitStatus / recordRateLimitHit', () => {
  it('allows requests under the limit and records failures', () => {
    expect(rateLimitStatus('k', 3, 60_000).allowed).toBe(true)
    recordRateLimitHit('k')
    expect(rateLimitStatus('k', 3, 60_000).allowed).toBe(true)
    recordRateLimitHit('k')
    expect(rateLimitStatus('k', 3, 60_000).allowed).toBe(true)
    recordRateLimitHit('k')
    // At the limit now.
    const blocked = rateLimitStatus('k', 3, 60_000)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThan(0)
  })

  it('does not count hits from outside the window (sliding)', () => {
    recordRateLimitHit('k')
    recordRateLimitHit('k')
    recordRateLimitHit('k')
    expect(rateLimitStatus('k', 3, 60_000).allowed).toBe(false)
    // First hit leaves the window → unblocked.
    vi.advanceTimersByTime(60_001)
    expect(rateLimitStatus('k', 3, 60_000).allowed).toBe(true)
  })

  it('reports retryAfter based on the oldest in-window hit', () => {
    recordRateLimitHit('k')
    vi.advanceTimersByTime(30_000)
    recordRateLimitHit('k')
    recordRateLimitHit('k')
    // Oldest hit is 30s old → releases in 30s.
    const blocked = rateLimitStatus('k', 3, 60_000)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSec).toBe(30)
  })

  it('keys are independent', () => {
    for (let i = 0; i < 5; i++) recordRateLimitHit('ip-a')
    expect(rateLimitStatus('ip-a', 5, 60_000).allowed).toBe(false)
    expect(rateLimitStatus('ip-b', 5, 60_000).allowed).toBe(true)
  })

  it('minimum retryAfter of 1s (never 0 when blocked)', () => {
    for (let i = 0; i < 2; i++) recordRateLimitHit('k')
    vi.advanceTimersByTime(59_999)
    const blocked = rateLimitStatus('k', 2, 60_000)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1)
  })
})

describe('clientIpFrom', () => {
  it('takes the first X-Forwarded-For entry (single trusted Caddy hop)', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })
    expect(clientIpFrom(h)).toBe('203.0.113.9')
  })
  it('trims whitespace around the entry', () => {
    const h = new Headers({ 'x-forwarded-for': ' 203.0.113.9 ' })
    expect(clientIpFrom(h)).toBe('203.0.113.9')
  })
  it('falls back to x-real-ip, then local', () => {
    expect(clientIpFrom(new Headers({ 'x-real-ip': '198.51.100.7' }))).toBe('198.51.100.7')
    expect(clientIpFrom(new Headers())).toBe('local')
  })
  it('empty XFF falls through rather than yielding an empty key', () => {
    const h = new Headers({ 'x-forwarded-for': '' })
    expect(clientIpFrom(h)).toBe('local')
  })
})
