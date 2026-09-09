import { describe, it, expect } from 'vitest'
import {
  formatINR,
  formatINRCompact,
  formatDate,
  timeAgo,
  confidenceColor,
  statusColor,
  findingTypeLabel,
  assessmentLabel,
  recommendedActionLabel,
  evidenceTypeLabel,
  sourceLabel,
} from '../../src/lib/gavel'

describe('formatINR', () => {
  it('returns — for null/undefined/NaN', () => {
    expect(formatINR(null)).toBe('—')
    expect(formatINR(undefined)).toBe('—')
    expect(formatINR(NaN)).toBe('—')
    expect(formatINR(Infinity)).toBe('—')
  })

  it('formats 0 as ₹0', () => {
    expect(formatINR(0)).toBe('₹0')
  })

  it('formats 3-digit numbers without grouping', () => {
    expect(formatINR(999)).toBe('₹999')
  })

  it('formats using Indian numbering system (last 3 digits, then 2s)', () => {
    // 1,23,456 — Indian grouping (not 123,456)
    expect(formatINR(123456)).toBe('₹1,23,456')
    expect(formatINR(12345678)).toBe('₹1,23,45,678')
  })

  it('handles negative numbers with a leading minus', () => {
    expect(formatINR(-1000)).toBe('-₹1,000')
  })
})

describe('formatINRCompact', () => {
  it('returns — for null/NaN', () => {
    expect(formatINRCompact(null)).toBe('—')
    expect(formatINRCompact(NaN)).toBe('—')
  })

  it('uses L (lakh) for 100,000+', () => {
    expect(formatINRCompact(100000)).toBe('₹1.00 L')
    expect(formatINRCompact(1500000)).toBe('₹15.00 L')
  })

  it('uses Cr (crore) for 1,00,00,000+', () => {
    expect(formatINRCompact(10000000)).toBe('₹1.00 Cr')
    expect(formatINRCompact(150000000)).toBe('₹15.00 Cr')
  })

  it('uses k for thousands', () => {
    expect(formatINRCompact(1500)).toBe('₹1.5k')
    expect(formatINRCompact(999)).toBe('₹999')
  })
})

describe('formatDate', () => {
  it('returns — for null/invalid', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate('not a date')).toBe('—')
  })

  it('formats ISO date string', () => {
    const result = formatDate('2025-03-15T10:00:00Z')
    expect(result).toMatch(/Mar/)
    expect(result).toMatch(/15/)
    expect(result).toMatch(/2025/)
  })
})

describe('timeAgo', () => {
  it('returns — for null/invalid', () => {
    expect(timeAgo(null)).toBe('—')
    expect(timeAgo('not a date')).toBe('—')
  })

  it('returns "just now" for very recent', () => {
    const now = new Date()
    expect(timeAgo(now)).toBe('just now')
  })

  it('returns minutes ago', () => {
    const d = new Date(Date.now() - 5 * 60_000)
    expect(timeAgo(d)).toBe('5m ago')
  })

  it('returns hours ago', () => {
    const d = new Date(Date.now() - 3 * 60 * 60_000)
    expect(timeAgo(d)).toBe('3h ago')
  })

  it('returns days ago', () => {
    const d = new Date(Date.now() - 5 * 24 * 60 * 60_000)
    expect(timeAgo(d)).toBe('5d ago')
  })
})

describe('confidenceColor', () => {
  it('returns emerald for HIGH', () => {
    const c = confidenceColor('HIGH')
    expect(c.text).toMatch(/emerald/)
  })

  it('returns amber for MEDIUM', () => {
    const c = confidenceColor('MEDIUM')
    expect(c.text).toMatch(/amber/)
  })

  it('returns rose for LOW', () => {
    const c = confidenceColor('LOW')
    expect(c.text).toMatch(/rose/)
  })

  it('returns muted for unknown', () => {
    const c = confidenceColor('UNKNOWN')
    expect(c.text).toMatch(/muted/)
  })
})

describe('statusColor', () => {
  it('returns emerald for approved', () => {
    expect(statusColor('approved').text).toMatch(/emerald/)
  })
  it('returns muted for dismissed', () => {
    expect(statusColor('dismissed').text).toMatch(/muted/)
  })
  it('returns rose for escalated', () => {
    expect(statusColor('escalated').text).toMatch(/rose/)
  })
  it('returns amber for pending_review', () => {
    expect(statusColor('pending_review').text).toMatch(/amber/)
  })
})

describe('findingTypeLabel', () => {
  it('humanizes snake_case types', () => {
    expect(findingTypeLabel('missed_milestone')).toBe('Missed milestone')
    expect(findingTypeLabel('unbilled_overage')).toBe('Unbilled overage')
    expect(findingTypeLabel('scope_expansion')).toBe('Scope expansion')
    expect(findingTypeLabel('rate_discrepancy')).toBe('Rate discrepancy')
    expect(findingTypeLabel('unauthorized_work')).toBe('Unauthorized work')
  })

  it('passes through unknown types', () => {
    expect(findingTypeLabel('unknown_type')).toBe('unknown_type')
  })
})

describe('assessmentLabel', () => {
  it('humanizes assessment', () => {
    expect(assessmentLabel('billable')).toBe('Billable')
    expect(assessmentLabel('already_covered')).toBe('Already covered')
    expect(assessmentLabel('ambiguous')).toBe('Ambiguous')
  })
})

describe('recommendedActionLabel', () => {
  it('humanizes recommended action', () => {
    expect(recommendedActionLabel('approve')).toBe('Approve & bill')
    expect(recommendedActionLabel('dismiss')).toBe('Dismiss')
    expect(recommendedActionLabel('request_review')).toBe('Request review')
    expect(recommendedActionLabel('draft_change_order')).toBe('Draft change order')
  })
})

describe('evidenceTypeLabel', () => {
  it('humanizes evidence types', () => {
    expect(evidenceTypeLabel('contract_clause')).toBe('Contract clause')
    expect(evidenceTypeLabel('delivery_record')).toBe('Delivery record')
    expect(evidenceTypeLabel('billing_record')).toBe('Billing record')
    expect(evidenceTypeLabel('supporting')).toBe('Supporting record')
    expect(evidenceTypeLabel('contradicting')).toBe('Contradicting record')
  })
})

describe('sourceLabel', () => {
  it('uppercases SOW', () => {
    expect(sourceLabel('sow')).toBe('SOW')
  })
  it('passes through proper nouns', () => {
    expect(sourceLabel('jira')).toBe('Jira')
    expect(sourceLabel('github')).toBe('GitHub')
    expect(sourceLabel('gitlab')).toBe('GitLab')
  })
  it('humanizes compound', () => {
    expect(sourceLabel('change_order')).toBe('Change order')
  })
})
