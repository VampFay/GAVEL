// GAVEL — request principal cache (production blockers #2 + #3).
//
// Middleware verifies the JWT statelessly; but role, status, tenant and
// token epoch live in the database and change over time. Resolving them
// with a DB round-trip on EVERY request would add latency for information
// that is nearly always unchanged — so we cache per user for a short TTL
// and invalidate eagerly on provisioning mutations (same process) with the
// TTL as the cross-instance backstop.
//
// What this buys (with the TTL/cache parameters below):
//   - disable user      → API access cut within ≤30s on any instance,
//                         immediately on the instance that made the change
//   - role change       → same window; we ALSO bump the token epoch on
//                         role changes, which forces a clean re-login with
//                         fresh claims instead of a stale-role JWT
//   - password reset    → epoch bump → every outstanding JWT is dead
//   - tenant move       → visible within the same window (rare op)
//
// Cache discipline: Map with a hard size cap (defensive against unbounded
// unique-user sprays), lazy eviction of expired entries on write, and a
// test hook to reset state between unit runs.

import { PrismaClient } from '@prisma/client'
import { db } from './db'

export interface RequestPrincipal {
  userId: string
  tenantId: string | null
  role: string
  status: string
  tokenEpoch: number
}

interface CacheEntry {
  principal: RequestPrincipal
  fetchedAt: number
}

const TTL_MS = 30_000
const MAX_ENTRIES = 2000

const cache = new Map<string, CacheEntry>()

/** Resolve the live principal for a user id (cached). Returns null if the user row is gone. */
export async function getRequestPrincipal(
  userId: string,
  prisma: Pick<PrismaClient, 'user'> = db
): Promise<RequestPrincipal | null> {
  const hit = cache.get(userId)
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit.principal

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, tenantId: true, role: true, status: true, tokenEpoch: true },
  })
  if (!user) return null

  const principal: RequestPrincipal = {
    userId: user.id,
    tenantId: user.tenantId,
    role: user.role,
    status: user.status,
    tokenEpoch: user.tokenEpoch,
  }
  put(userId, principal)
  return principal
}

function put(userId: string, principal: RequestPrincipal): void {
  // Lazy sweep: when over cap, drop expired entries; if still over cap,
  // clear entirely (a 2000-user burst on one node is not a shape this
  // tool needs to keep warm).
  if (cache.size >= MAX_ENTRIES) {
    const now = Date.now()
    for (const [k, v] of cache) {
      if (now - v.fetchedAt >= TTL_MS) cache.delete(k)
    }
    if (cache.size >= MAX_ENTRIES) cache.clear()
  }
  cache.set(userId, { principal, fetchedAt: Date.now() })
}

/** Invalidate one user's cached principal (call after ANY User mutation). */
export function invalidatePrincipal(userId: string): void {
  cache.delete(userId)
}

/** Test hook. */
export function __resetPrincipalCacheForTests(): void {
  cache.clear()
}
