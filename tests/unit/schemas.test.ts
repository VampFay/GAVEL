import { describe, it, expect } from 'vitest'
import {
  CreateClientSchema,
  ExtractContractSchema,
  PatchFindingSchema,
  FindingAction,
  PaginationSchema,
  AckAlertSchema,
  ToggleMonitoringSchema,
} from '../../src/lib/schemas'

describe('CreateClientSchema', () => {
  it('requires a name', () => {
    const r = CreateClientSchema.safeParse({})
    expect(r.success).toBe(false)
  })

  it('rejects empty name', () => {
    const r = CreateClientSchema.safeParse({ name: '   ' })
    expect(r.success).toBe(false)
  })

  it('rejects invalid email', () => {
    const r = CreateClientSchema.safeParse({ name: 'Acme', contactEmail: 'not-an-email' })
    expect(r.success).toBe(false)
  })

  it('accepts valid input', () => {
    const r = CreateClientSchema.safeParse({
      name: 'Acme Corp',
      industry: 'Fintech',
      sizeBand: '10-50',
      contactName: 'Jane',
      contactEmail: 'jane@acme.com',
    })
    expect(r.success).toBe(true)
  })

  it('rejects unknown sizeBand', () => {
    const r = CreateClientSchema.safeParse({ name: 'Acme', sizeBand: 'banana' })
    expect(r.success).toBe(false)
  })

  it('accepts empty string for sizeBand (normalized to undefined)', () => {
    const r = CreateClientSchema.safeParse({ name: 'Acme', sizeBand: '' })
    expect(r.success).toBe(true)
  })
})

describe('ExtractContractSchema', () => {
  it('requires rawText of at least 30 chars', () => {
    const r = ExtractContractSchema.safeParse({ rawText: 'short' })
    expect(r.success).toBe(false)
  })

  it('rejects rawText over 256KB', () => {
    const r = ExtractContractSchema.safeParse({ rawText: 'x'.repeat(256_001) })
    expect(r.success).toBe(false)
  })

  it('defaults persist to false (safer than the previous true)', () => {
    const r = ExtractContractSchema.safeParse({ rawText: 'x'.repeat(40) })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.persist).toBe(false)
  })

  it('accepts a valid clientId as cuid', () => {
    const r = ExtractContractSchema.safeParse({
      rawText: 'x'.repeat(40),
      clientId: 'cmt9q9dvj0000mgdkp42yunyt',
    })
    expect(r.success).toBe(true)
  })

  it('rejects malformed clientId', () => {
    const r = ExtractContractSchema.safeParse({
      rawText: 'x'.repeat(40),
      clientId: 'not-a-cuid',
    })
    expect(r.success).toBe(false)
  })
})

describe('PatchFindingSchema', () => {
  it('accepts approve', () => {
    const r = PatchFindingSchema.safeParse({ action: 'approve' })
    expect(r.success).toBe(true)
  })
  it('accepts dismiss', () => {
    const r = PatchFindingSchema.safeParse({ action: 'dismiss' })
    expect(r.success).toBe(true)
  })
  it('accepts escalate', () => {
    const r = PatchFindingSchema.safeParse({ action: 'escalate' })
    expect(r.success).toBe(true)
  })
  it('rejects unknown action', () => {
    const r = PatchFindingSchema.safeParse({ action: 'banana' })
    expect(r.success).toBe(false)
  })
  it('rejects reviewNotes over 10KB', () => {
    const r = PatchFindingSchema.safeParse({
      action: 'approve',
      reviewNotes: 'x'.repeat(10_001),
    })
    expect(r.success).toBe(false)
  })
})

describe('FindingAction enum', () => {
  it('has exactly 3 actions', () => {
    const values = FindingAction.options
    expect(values).toEqual(['approve', 'dismiss', 'escalate'])
  })
})

describe('PaginationSchema', () => {
  it('defaults limit to 50', () => {
    const r = PaginationSchema.safeParse({})
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.limit).toBe(50)
  })

  it('coerces string limit to number', () => {
    const r = PaginationSchema.safeParse({ limit: '25' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.limit).toBe(25)
  })

  it('rejects limit > 200', () => {
    const r = PaginationSchema.safeParse({ limit: 500 })
    expect(r.success).toBe(false)
  })

  it('rejects limit < 1', () => {
    const r = PaginationSchema.safeParse({ limit: 0 })
    expect(r.success).toBe(false)
  })
})

describe('AckAlertSchema', () => {
  it('accepts boolean acknowledged', () => {
    expect(AckAlertSchema.safeParse({ acknowledged: true }).success).toBe(true)
    expect(AckAlertSchema.safeParse({ acknowledged: false }).success).toBe(true)
  })
  it('rejects non-boolean', () => {
    expect(AckAlertSchema.safeParse({ acknowledged: 'true' }).success).toBe(false)
  })
})

describe('ToggleMonitoringSchema', () => {
  it('accepts boolean alertsEnabled', () => {
    expect(ToggleMonitoringSchema.safeParse({ alertsEnabled: true }).success).toBe(true)
    expect(ToggleMonitoringSchema.safeParse({ alertsEnabled: false }).success).toBe(true)
  })
  it('rejects non-boolean', () => {
    expect(ToggleMonitoringSchema.safeParse({ alertsEnabled: 'yes' }).success).toBe(false)
  })
})
