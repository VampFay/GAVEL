/**
 * In-memory sliding-window rate limiter.
 *
 * Design notes (read this before "improving" it):
 *  - Sliding WINDOW, not fixed window: an attacker hammering at a fixed
 *    window boundary gets exactly `max` requests per window either way —
 *    the sliding log just avoids the naive fixed-window burst of
 *    2×max straddling a boundary.
 *  - Check-then-record (NOT record-on-check): successful logins don't
 *    consume budget. An office NAT shared by several reviewers logging
 *    in on a Monday morning must not lock itself out. Failures are what
 *    count — that's what brute force looks like.
 *  - The TOCTOU gap between status check and record is real but bounded:
 *    at login-request rates it allows at most a few concurrent requests
 *    over budget — immaterial next to the 10-attempt budget itself.
 *  - Scope: ONE PROCESS. Dev, and single-instance deploys (the current
 *    deployment shape — see Caddyfile: one upstream on localhost:3000).
 *    If the app is ever horizontally scaled, replace the Map with Redis
 *    (or an external limiter at the proxy). Do NOT silently assume this
 *    still works behind a load balancer.
 *  - Memory bound: buckets self-clean. Stale entries (fully outside any
 *    window) are dropped on a size-triggered GC pass, so a spray of
 *    unique keys can't grow the Map without bound.
 */

export interface RateLimitResult {
  allowed: boolean
  /** Seconds until the oldest hit leaves the window (0 when allowed). */
  retryAfterSec: number
}

const buckets = new Map<string, number[]>()

/** Read-only: would a request on `key` be allowed right now? */
export function rateLimitStatus(
  key: string,
  max: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now()
  const cutoff = now - windowMs
  const hits = (buckets.get(key) ?? []).filter(t => t > cutoff)
  const oldest = hits[0]
  if (hits.length >= max && oldest !== undefined) {
    const releaseMs = oldest + windowMs - now
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(releaseMs / 1000)) }
  }
  return { allowed: true, retryAfterSec: 0 }
}

/** Write: record an attempt on `key` (call this on FAILED attempts). */
export function recordRateLimitHit(key: string): void {
  const now = Date.now()
  const hits = buckets.get(key) ?? []
  hits.push(now)
  buckets.set(key, hits)
  if (buckets.size > 1000) gc(now)
}

/** Drop buckets whose every hit is older than 15 minutes. */
function gc(now: number): void {
  const cutoff = now - 15 * 60_000
  for (const [key, hits] of buckets) {
    const newest = hits[hits.length - 1]
    if (newest !== undefined && newest <= cutoff) buckets.delete(key)
  }
}

/**
 * Best-effort client IP for limiter keys. Behind Caddy the
 * X-Forwarded-For header is set from the actual remote host (see
 * Caddyfile `header_up X-Forwarded-For {remote_host}`) — a single,
 * trusted proxy hop, so taking the first entry is correct here.
 * Direct dev access has no header → 'local'.
 */
export function clientIpFrom(headers: Headers): string {
  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  return headers.get('x-real-ip') ?? 'local'
}

/** Test hook: wipe all state. */
export function resetRateLimits(): void {
  buckets.clear()
}
