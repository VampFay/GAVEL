import { describe, it, expect } from 'vitest'
import {
  runWithTenant,
  runUnscoped,
  getTenantContext,
  currentTenantId,
  requireTenantId,
  TenantContextError,
  DEMO_TENANT_ID,
} from '../../src/lib/tenant-context'

describe('tenant-context (AsyncLocalStorage)', () => {
  it('runWithTenant establishes a readable context', () => {
    expect(currentTenantId()).toBeNull() // no context outside
    runWithTenant('t-1', () => {
      expect(currentTenantId()).toBe('t-1')
      expect(requireTenantId()).toBe('t-1')
      expect(getTenantContext()).toEqual({ tenantId: 't-1', unscoped: false })
    })
    expect(currentTenantId()).toBeNull()
  })

  it('context propagates across await boundaries', async () => {
    await runWithTenant('t-2', async () => {
      await new Promise(r => setTimeout(r, 1))
      expect(currentTenantId()).toBe('t-2')
      await Promise.all([
        new Promise(r => setTimeout(r, 1)).then(() => expect(currentTenantId()).toBe('t-2')),
        new Promise(r => setTimeout(r, 2)).then(() => expect(currentTenantId()).toBe('t-2')),
      ])
    })
  })

  it('nested runs override for their scope and restore after', () => {
    runWithTenant('outer', () => {
      runWithTenant('inner', () => {
        expect(currentTenantId()).toBe('inner')
      })
      expect(currentTenantId()).toBe('outer')
    })
  })

  it('runUnscoped marks the context explicitly unscoped', () => {
    runUnscoped(() => {
      expect(currentTenantId()).toBeNull()
      expect(getTenantContext()?.unscoped).toBe(true)
      expect(requireTenantId()).toBe('') // '' = unscoped mode (scripts)
    })
  })

  it('requireTenantId THROWS inside a tenantless (fail-closed) context', () => {
    runWithTenant(null, () => {
      expect(() => requireTenantId()).toThrow(TenantContextError)
    })
  })

  it('DEMO_TENANT_ID is the stable demo tenant', () => {
    expect(DEMO_TENANT_ID).toBe('demo-tenant')
  })
})
