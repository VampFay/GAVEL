import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getRequestPrincipal,
  invalidatePrincipal,
  __resetPrincipalCacheForTests,
  type RequestPrincipal,
} from '../../src/lib/request-principal'

// Fake prisma.user source — the module accepts an injected source so the
// test never touches the real client or env validation.
function fakeUserSource(rows: Record<string, unknown>) {
  return {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows[where.id] ?? null),
    },
  }
}

const USER_A = {
  id: 'user-a',
  tenantId: 'tenant-1',
  role: 'admin',
  status: 'active',
  tokenEpoch: 0,
}

beforeEach(() => {
  __resetPrincipalCacheForTests()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
})

describe('getRequestPrincipal (30s TTL cache)', () => {
  it('resolves the live principal from the user source', async () => {
    const src = fakeUserSource({ 'user-a': USER_A })
    const p = await getRequestPrincipal('user-a', src as never)
    expect(p).toEqual({
      userId: 'user-a',
      tenantId: 'tenant-1',
      role: 'admin',
      status: 'active',
      tokenEpoch: 0,
    })
  })

  it('caches within the TTL — no second query', async () => {
    const src = fakeUserSource({ 'user-a': USER_A })
    await getRequestPrincipal('user-a', src as never)
    await getRequestPrincipal('user-a', src as never)
    expect(src.user.findUnique).toHaveBeenCalledTimes(1)
  })

  it('re-fetches after the TTL expires', async () => {
    const src = fakeUserSource({ 'user-a': USER_A })
    await getRequestPrincipal('user-a', src as never)
    vi.advanceTimersByTime(31_000)
    await getRequestPrincipal('user-a', src as never)
    expect(src.user.findUnique).toHaveBeenCalledTimes(2)
  })

  it('invalidation forces a re-fetch even inside the TTL', async () => {
    const src = fakeUserSource({ 'user-a': USER_A })
    await getRequestPrincipal('user-a', src as never)
    invalidatePrincipal('user-a')
    await getRequestPrincipal('user-a', src as never)
    expect(src.user.findUnique).toHaveBeenCalledTimes(2)
  })

  it('reflects revoked state (epoch bump) after cache expiry', async () => {
    let current = { ...USER_A }
    const src = {
      user: { findUnique: vi.fn(async () => current) },
    }
    const first = (await getRequestPrincipal('user-a', src as never)) as RequestPrincipal
    expect(first.tokenEpoch).toBe(0)
    // Admin bumps the epoch (role change) + invalidates.
    current = { ...USER_A, role: 'viewer', tokenEpoch: 1 }
    invalidatePrincipal('user-a')
    const second = (await getRequestPrincipal('user-a', src as never)) as RequestPrincipal
    expect(second.tokenEpoch).toBe(1)
    expect(second.role).toBe('viewer')
  })

  it('returns null for a missing user (deleted / reseeded)', async () => {
    const src = fakeUserSource({})
    expect(await getRequestPrincipal('ghost', src as never)).toBeNull()
  })
})
