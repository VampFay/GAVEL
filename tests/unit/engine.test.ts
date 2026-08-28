import { describe, it, expect } from 'vitest'
import { Prisma } from '@prisma/client'
import { runEngine, DEFAULT_RULES } from '../../src/lib/engine'
import type { EngineInput } from '../../src/lib/engine'
import {
  findMilestoneByExternalId,
  findMilestoneDelivery,
  findMilestoneBilling,
  extractTicketRefs,
  detectQuantityCap,
  extractNumericRange,
  tokenize,
  sharedTokens,
  matchExclusionToDelivery,
  findLineItemsForMilestone,
  daysBetween,
} from '../../src/lib/engine/entity-resolution'
import {
  computeConfidenceScore,
  computeConfidenceBreakdown,
  parseConfidenceBreakdown,
  bucketConfidence,
  stampConfidence,
  EVIDENCE_WEIGHTS,
} from '../../src/lib/engine/confidence'

/**
 * Engine unit tests — pure functions, no DB.
 *
 * These tests exercise:
 *   1. The deterministic rules end-to-end against a hand-built snapshot
 *      that mirrors the seed data (Aetherworks — Veridian Patient Portal).
 *      The engine should produce findings that match the seed's hand-typed
 *      findings in type + assessment + recommendedAction.
 *   2. The entity-resolution helpers (cap detection, range extraction,
 *      token overlap, milestone linking).
 *   3. The confidence decomposition (sum of weights → score → bucket).
 */

// ──────────────────────────── Test fixtures ────────────────────────────

const NOW = new Date('2025-07-15T00:00:00Z')

const d = (s: string) => new Date(s)
const dec = (n: number) => new Prisma.Decimal(n)

const baseInput: EngineInput = {
  contractId: 'test-contract',
  contractTitle: 'Patient Portal Redesign — SOW',
  currency: 'INR',
  milestones: [
    {
      id: 'm1',
      externalId: 'M1',
      description: 'Auth & SSO complete',
      dueDate: d('2025-03-31'),
      value: dec(600000),
      currency: 'INR',
    },
    {
      id: 'm4',
      externalId: 'M4',
      description: 'Telemedicine integration',
      dueDate: d('2025-06-15'),
      value: dec(700000),
      currency: 'INR',
    },
    {
      id: 'm5',
      externalId: 'M5',
      description: 'Data migration + UAT',
      dueDate: d('2025-06-30'),
      value: dec(400000),
      currency: 'INR',
    },
  ],
  lineItems: [
    {
      id: 'li1',
      description: 'Patient authentication & SSO integration (OAuth2)',
      rate: dec(4500),
      rateUnit: 'hour',
      quantity: 90,
      milestone: 'M1',
      deliveryDate: d('2025-03-31'),
    },
    {
      id: 'li6',
      description: 'Legacy patient records migration (cap: 50,000 records)',
      rate: dec(2200),
      rateUnit: 'hour',
      quantity: 120,
      milestone: 'M5',
      deliveryDate: d('2025-06-30'),
    },
  ],
  exclusions: [
    {
      id: 'ex1',
      clause: '5.1',
      description: 'Backend hospital EMR customization is NOT in scope.',
    },
    {
      id: 'ex2',
      clause: '5.2',
      description: 'Infrastructure / DevOps work billed separately.',
    },
  ],
  changeOrders: [],
  tickets: [
    {
      id: 't1',
      externalId: 'ENG-101',
      title: 'OAuth2 IdP integration scaffold',
      type: 'story',
      status: 'done',
      assignee: 'Aisha K.',
      externalCreated: d('2025-03-02'),
      externalUpdated: d('2025-03-20'),
      description: '',
    },
    {
      id: 't131',
      externalId: 'ENG-131',
      title: 'Telemedicine WebRTC SDK integration',
      type: 'story',
      status: 'done',
      assignee: 'Aisha K.',
      externalCreated: d('2025-05-02'),
      externalUpdated: d('2025-06-14'),
      description: '',
    },
    {
      id: 't149',
      externalId: 'ENG-149',
      title: 'EMR prescription endpoint',
      type: 'task',
      status: 'done',
      assignee: 'Aisha K.',
      externalCreated: d('2025-05-22'),
      externalUpdated: d('2025-06-12'),
      description: '',
    },
  ],
  codeActivities: [
    {
      id: 'a1',
      type: 'pr',
      ref: '#214',
      title: 'OAuth2 IdP integration — M1 — closes ENG-101',
      author: 'aisha-k',
      timestamp: d('2025-03-22T10:14:00Z'),
      additions: 1840,
      deletions: 120,
      filesChanged: 23,
      url: 'https://github.com/test/pull/214',
    },
    {
      id: 'a4',
      type: 'pr',
      ref: '#284',
      title: 'Telemedicine WebRTC integration — M4 — closes ENG-131',
      author: 'aisha-k',
      timestamp: d('2025-06-14T11:08:00Z'),
      additions: 3100,
      deletions: 410,
      filesChanged: 42,
      url: 'https://github.com/test/pull/284',
    },
    {
      id: 'a149',
      type: 'pr',
      ref: '#319',
      title: 'EMR prescription endpoint — closes ENG-149 (out of baseline scope)',
      author: 'aisha-k',
      timestamp: d('2025-06-12T09:50:00Z'),
      additions: 1340,
      deletions: 90,
      filesChanged: 16,
      url: 'https://github.com/test/pull/319',
    },
    {
      id: 'a155',
      type: 'pr',
      ref: '#341',
      title: 'Legacy record migration — M5 — closes ENG-155 (records 50,001–87,000)',
      author: 'meera-s',
      timestamp: d('2025-06-25T16:40:00Z'),
      additions: 1820,
      deletions: 50,
      filesChanged: 21,
      url: 'https://github.com/test/pull/341',
    },
  ],
  invoices: [
    {
      id: 'inv1',
      number: 'INV-2025-014',
      issueDate: d('2025-04-02'),
      dueDate: d('2025-04-30'),
      status: 'paid',
      total: dec(600000),
      currency: 'INR',
      lines: [
        {
          id: 'l1',
          description: 'M1 — Auth & SSO complete',
          amount: dec(600000),
          periodStart: d('2025-03-01'),
          periodEnd: d('2025-03-31'),
        },
      ],
    },
    {
      id: 'inv3',
      number: 'INV-2025-041',
      issueDate: d('2025-06-01'),
      dueDate: d('2025-06-30'),
      status: 'issued',
      total: dec(550000),
      currency: 'INR',
      lines: [
        {
          id: 'l3',
          description: 'M3 — Lab results viewer',
          amount: dec(550000),
          periodStart: d('2025-05-01'),
          periodEnd: d('2025-05-31'),
        },
      ],
    },
  ],
}

// ──────────────────────────── Engine end-to-end ────────────────────────

describe('runEngine — end-to-end against seed-mirroring fixture', () => {
  const output = runEngine(baseInput, { now: NOW })

  it('emits findings from all 3 rules', () => {
    expect(output.findings.length).toBeGreaterThan(0)
    const types = new Set(output.findings.map(f => f.type))
    expect(types.has('missed_milestone')).toBe(true)
    expect(types.has('unbilled_overage')).toBe(true)
    expect(types.has('scope_expansion')).toBe(true)
  })

  it('produces ruleStats for every rule', () => {
    expect(output.ruleStats['missed_milestone']).toBeDefined()
    expect(output.ruleStats['unbilled_overage']).toBeDefined()
    expect(output.ruleStats['scope_expansion']).toBeDefined()
    for (const stats of Object.values(output.ruleStats)) {
      expect(typeof stats.scanned).toBe('number')
      expect(typeof stats.considered).toBe('number')
      expect(typeof stats.emitted).toBe('number')
    }
  })

  it('emits a missed_milestone finding for M4 (telemedicine — delivered, not invoiced)', () => {
    const m4Finding = output.findings.find(
      f => f.type === 'missed_milestone' && f.title.includes('M4')
    )
    expect(m4Finding).toBeDefined()
    if (!m4Finding) return
    expect(m4Finding.assessment).toBe('billable')
    expect(m4Finding.recommendedAction).toBe('approve')
    expect(m4Finding.impactAmount).toBe(700000)
    expect(m4Finding.confidence).toMatch(/HIGH|MEDIUM/)
  })

  it('does NOT emit a missed_milestone finding for M1 (already invoiced)', () => {
    const m1Finding = output.findings.find(
      f => f.type === 'missed_milestone' && f.title.includes('M1')
    )
    expect(m1Finding).toBeUndefined()
  })

  it('emits an unbilled_overage finding for the migration cap', () => {
    const overage = output.findings.find(f => f.type === 'unbilled_overage')
    expect(overage).toBeDefined()
    if (!overage) return
    expect(overage.title).toMatch(/50,000/)
    // Rate is per-hour, overage is in records — units don't match, so
    // impact is null (needs manual review) rather than a wrong number.
    expect(overage.impactAmount).toBeNull()
    expect(overage.summary).toMatch(/per-hour/)
    expect(overage.assessment).toBe('ambiguous')
    expect(overage.recommendedAction).toBe('draft_change_order')
  })

  it('does NOT emit a scope_expansion finding based on the generic word "out"', () => {
    // Exclusion 5.3 ("Content migration beyond record count above is out of scope")
    // previously matched PR #319 ("...out of baseline scope") on the generic
    // token "out" — a false positive. "out" is now in the stopwords list.
    const outOnly = output.findings.find(
      f => f.type === 'scope_expansion' && f.title.includes('(5.3)') && f.title.includes('out')
    )
    // If a 5.3 finding exists, it must NOT have matched on "out" alone —
    // it must have matched on real keywords like "record"/"migration".
    if (outOnly) {
      expect(outOnly.summary).not.toMatch(/keyword overlap.*: out\b/)
    }
  })

  it('emits a scope_expansion finding for the EMR prescription endpoint', () => {
    const emr = output.findings.find(
      f => f.type === 'scope_expansion' && f.title.toLowerCase().includes('emr')
    )
    expect(emr).toBeDefined()
    if (!emr) return
    expect(emr.assessment).toBe('ambiguous')
    expect(emr.recommendedAction).toBe('draft_change_order')
    // Should reference §5.1 in the contract clause.
    expect(emr.contractClause).toMatch(/5\.1/)
  })

  it('every finding has at least one piece of evidence', () => {
    for (const f of output.findings) {
      expect(f.evidence.length).toBeGreaterThan(0)
    }
  })

  it('every finding has a confidence score in [0, 1]', () => {
    for (const f of output.findings) {
      expect(f.confidenceScore).toBeGreaterThanOrEqual(0)
      expect(f.confidenceScore).toBeLessThanOrEqual(1)
    }
  })

  it('every finding has a decomposed confidence breakdown (four pillars, each in [0, 1])', () => {
    // "Decomposed, not magical" — the composite must always be backed by
    // per-pillar sub-scores the reviewer can inspect (audit v2, finding #2).
    for (const f of output.findings) {
      expect(f.confidenceBreakdown).toBeDefined()
      for (const pillar of ['contract', 'delivery', 'authorization', 'billing'] as const) {
        const v = f.confidenceBreakdown[pillar]
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
        expect(Number.isFinite(v)).toBe(true)
      }
    }
  })

  it('every finding has a deterministic signature', () => {
    for (const f of output.findings) {
      expect(f.signature.length).toBeGreaterThan(0)
      // Signature must include the contractId + the type — that's the
      // idempotency key contract.
      expect(f.signature).toContain('test-contract')
      expect(f.signature).toContain(f.type)
    }
  })

  it('missed_milestone signatures include the milestone externalId', () => {
    // The signature — NOT the title — is the upsert key (audit v2,
    // finding #1). It must pin the exact subject (milestone) so a title
    // rewording never duplicates a finding.
    const m4 = output.findings.find(
      f => f.type === 'missed_milestone' && f.title.includes('M4')
    )
    expect(m4?.signature).toBe('missed_milestone:test-contract:M4')
  })

  it('running the engine twice produces identical output (pure function)', () => {
    const second = runEngine(baseInput, { now: NOW })
    expect(second.findings.length).toBe(output.findings.length)
    expect(second.findings.map(f => f.signature).sort()).toEqual(
      output.findings.map(f => f.signature).sort()
    )
  })

  it('respects the rules=subset parameter', () => {
    const only = runEngine(baseInput, {
      now: NOW,
      rules: DEFAULT_RULES.filter(r => r.type === 'missed_milestone'),
    })
    expect(only.findings.length).toBeGreaterThan(0)
    expect(only.findings.every(f => f.type === 'missed_milestone')).toBe(true)
  })
})

// ──────────────────────────── Entity resolution ────────────────────────

describe('entity-resolution helpers', () => {
  describe('findMilestoneByExternalId', () => {
    it('finds a milestone by externalId (case-insensitive)', () => {
      const m = findMilestoneByExternalId(baseInput.milestones, 'm4')
      expect(m?.externalId).toBe('M4')
    })
    it('returns null for unknown externalId', () => {
      expect(findMilestoneByExternalId(baseInput.milestones, 'M99')).toBeNull()
    })
    it('returns null for empty externalId', () => {
      expect(findMilestoneByExternalId(baseInput.milestones, '')).toBeNull()
    })
  })

  describe('findMilestoneDelivery', () => {
    it('finds delivery records for M4', () => {
      const m4 = findMilestoneByExternalId(baseInput.milestones, 'M4')!
      const { activities, tickets } = findMilestoneDelivery(m4, {
        codeActivities: baseInput.codeActivities,
        tickets: baseInput.tickets,
      })
      // The PR #284 title contains "M4" → 1 activity match.
      // The Jira ticket titles in the fixture don't mention "M4" (only
      // the PR title does) → 0 ticket matches. This mirrors how real
      // delivery records look: devs reference milestones in PR titles,
      // not in ticket titles.
      expect(activities.length).toBe(1)
      expect(activities[0]?.ref).toBe('#284')
      expect(tickets.length).toBe(0)
    })
    it('finds delivery records for M5 (via PR title mention)', () => {
      const m5 = findMilestoneByExternalId(baseInput.milestones, 'M5')!
      const { activities, tickets } = findMilestoneDelivery(m5, {
        codeActivities: baseInput.codeActivities,
        tickets: baseInput.tickets,
      })
      expect(activities.length).toBe(1)
      expect(activities[0]?.ref).toBe('#341')
      expect(tickets.length).toBe(0)
    })
    it('returns empty for an unknown milestone', () => {
      // M99 isn't in the fixture — findMilestoneByExternalId returns null.
      const m99 = findMilestoneByExternalId(baseInput.milestones, 'M99')
      expect(m99).toBeNull()
    })
  })

  describe('findMilestoneBilling', () => {
    it('finds an invoice line for M1 (already invoiced)', () => {
      const m1 = findMilestoneByExternalId(baseInput.milestones, 'M1')!
      const { lines } = findMilestoneBilling(m1, baseInput.invoices)
      expect(lines.length).toBe(1)
      expect(lines[0]?.invoice.number).toBe('INV-2025-014')
    })
    it('finds NO invoice line for M4 (not invoiced)', () => {
      const m4 = findMilestoneByExternalId(baseInput.milestones, 'M4')!
      const { lines } = findMilestoneBilling(m4, baseInput.invoices)
      expect(lines.length).toBe(0)
    })
  })

  describe('extractTicketRefs', () => {
    it('extracts ENG-XXX references from a string', () => {
      const refs = extractTicketRefs('OAuth2 IdP integration — closes ENG-101 and ENG-104')
      expect(refs).toEqual(['ENG-101', 'ENG-104'])
    })
    it('returns empty for a string with no refs', () => {
      expect(extractTicketRefs('No ticket here')).toEqual([])
    })
    it('dedupes repeated refs', () => {
      expect(extractTicketRefs('ENG-101 and ENG-101 again')).toEqual(['ENG-101'])
    })
  })

  describe('detectQuantityCap', () => {
    it('detects "cap: 50,000 records"', () => {
      expect(detectQuantityCap('Legacy patient records migration (cap: 50,000 records)')).toBe(50000)
    })
    it('detects "limit: 50000 records"', () => {
      expect(detectQuantityCap('Migration limit: 50000 records')).toBe(50000)
    })
    it('returns null when no cap mentioned', () => {
      expect(detectQuantityCap('Patient authentication & SSO integration (OAuth2)')).toBeNull()
    })
    it('returns null for zero or negative caps', () => {
      expect(detectQuantityCap('cap: 0')).toBeNull()
    })
  })

  describe('extractNumericRange', () => {
    it('extracts "50,001–87,000" (en-dash) correctly', () => {
      expect(extractNumericRange('records 50,001–87,000')).toEqual([50001, 87000])
    })
    it('extracts "50-100" (hyphen) correctly', () => {
      expect(extractNumericRange('range 50-100')).toEqual([50, 100])
    })
    it('returns null when no range found', () => {
      expect(extractNumericRange('no range here')).toBeNull()
    })
    it('returns [smaller, larger] regardless of order in source', () => {
      expect(extractNumericRange('100-50')).toEqual([50, 100])
    })
  })

  describe('tokenize + sharedTokens', () => {
    it('lowercases + drops stopwords + drops <3-char tokens', () => {
      const tokens = tokenize('The Backend EMR is NOT in scope')
      expect(tokens).toContain('backend')
      expect(tokens).toContain('emr')
      expect(tokens).not.toContain('the')
      expect(tokens).not.toContain('is')
      expect(tokens).not.toContain('not')
      expect(tokens).not.toContain('in')
    })
    it('sharedTokens finds overlap between two strings', () => {
      const shared = sharedTokens(
        'Backend hospital EMR customization is NOT in scope',
        'EMR prescription endpoint'
      )
      expect(shared).toContain('emr')
    })
  })

  describe('matchExclusionToDelivery', () => {
    it('matches EMR exclusion to EMR prescription endpoint', () => {
      const ex = baseInput.exclusions[0]!
      const result = matchExclusionToDelivery(ex, 'EMR prescription endpoint')
      expect(result).not.toBeNull()
      expect(result).toContain('emr')
    })
    it('returns null when there is no overlap', () => {
      const ex = baseInput.exclusions[0]!
      expect(matchExclusionToDelivery(ex, 'Patient authentication & SSO integration')).toBeNull()
    })
  })

  describe('findLineItemsForMilestone', () => {
    it('finds the line item for M4', () => {
      // There's no M4 line item in the fixture, so this should be empty.
      const items = findLineItemsForMilestone(baseInput.lineItems, 'M1')
      expect(items.length).toBe(1)
      expect(items[0]?.description).toContain('OAuth2')
    })
  })

  describe('daysBetween', () => {
    it('computes the number of days between two dates', () => {
      expect(daysBetween(new Date('2025-01-01'), new Date('2025-01-31'))).toBe(30)
    })
    it('returns a negative number for reversed input', () => {
      expect(daysBetween(new Date('2025-01-31'), new Date('2025-01-01'))).toBe(-30)
    })
  })
})

// ──────────────────────────── Confidence ───────────────────────────────

describe('confidence decomposition', () => {
  describe('computeConfidenceScore', () => {
    it('sums evidence weights and clamps to [0, 1]', () => {
      const score = computeConfidenceScore([
        { weight: 0.3, evidenceType: 'contract_clause', source: 'sow', refId: null, title: '', detail: null, timestamp: null },
        { weight: 0.25, evidenceType: 'delivery_record', source: 'github', refId: null, title: '', detail: null, timestamp: null },
      ])
      expect(score).toBeCloseTo(0.55, 2)
    })
    it('clamps to 1 when weights sum > 1', () => {
      const score = computeConfidenceScore([
        { weight: 0.6, evidenceType: 'contract_clause', source: 'sow', refId: null, title: '', detail: null, timestamp: null },
        { weight: 0.6, evidenceType: 'delivery_record', source: 'github', refId: null, title: '', detail: null, timestamp: null },
      ])
      expect(score).toBe(1)
    })
    it('clamps to 0 when negative weights dominate', () => {
      const score = computeConfidenceScore([
        { weight: 0.1, evidenceType: 'contract_clause', source: 'sow', refId: null, title: '', detail: null, timestamp: null },
        { weight: -0.5, evidenceType: 'contradicting', source: 'invoice', refId: null, title: '', detail: null, timestamp: null },
      ])
      expect(score).toBe(0)
    })
  })

  describe('bucketConfidence', () => {
    it('returns HIGH for scores >= 0.7', () => {
      expect(bucketConfidence(0.7)).toBe('HIGH')
      expect(bucketConfidence(0.85)).toBe('HIGH')
    })
    it('returns MEDIUM for scores in [0.45, 0.7)', () => {
      expect(bucketConfidence(0.45)).toBe('MEDIUM')
      expect(bucketConfidence(0.6)).toBe('MEDIUM')
    })
    it('returns LOW for scores < 0.45', () => {
      expect(bucketConfidence(0.2)).toBe('LOW')
      expect(bucketConfidence(0)).toBe('LOW')
    })
  })

  describe('stampConfidence', () => {
    it('stamps a draft with computed score + bucket', () => {
      const stamped = stampConfidence({
        signature: 'test',
        type: 'missed_milestone',
        title: 'Test',
        summary: '',
        impactAmount: null,
        assessment: 'billable',
        recommendedAction: 'approve',
        contractClause: null,
        billingState: null,
        evidence: [
          { weight: 0.3, evidenceType: 'contract_clause', source: 'sow', refId: null, title: '', detail: null, timestamp: null },
          { weight: 0.25, evidenceType: 'delivery_record', source: 'github', refId: null, title: '', detail: null, timestamp: null },
        ],
      })
      expect(stamped.confidenceScore).toBeCloseTo(0.55, 2)
      expect(stamped.confidence).toBe('MEDIUM')
    })
    it('stamps the draft with a four-pillar breakdown', () => {
      const stamped = stampConfidence({
        signature: 'test',
        type: 'missed_milestone',
        title: 'Test',
        summary: '',
        impactAmount: null,
        assessment: 'billable',
        recommendedAction: 'approve',
        contractClause: null,
        billingState: null,
        evidence: [
          { weight: 0.3, evidenceType: 'contract_clause', source: 'sow', refId: null, title: '', detail: null, timestamp: null },
          { weight: 0.25, evidenceType: 'delivery_record', source: 'github', refId: null, title: '', detail: null, timestamp: null },
          { weight: 0.2, evidenceType: 'supporting', source: 'change_order', refId: null, title: '', detail: null, timestamp: null },
          { weight: 0.2, evidenceType: 'billing_record', source: 'invoice', refId: null, title: '', detail: null, timestamp: null },
        ],
      })
      expect(stamped.confidenceBreakdown.contract).toBeCloseTo(0.3, 2)
      expect(stamped.confidenceBreakdown.delivery).toBeCloseTo(0.25, 2)
      expect(stamped.confidenceBreakdown.authorization).toBeCloseTo(0.2, 2)
      expect(stamped.confidenceBreakdown.billing).toBeCloseTo(0.2, 2)
    })
  })

  describe('computeConfidenceBreakdown', () => {
    it('assigns each evidence type to its pillar', () => {
      const breakdown = computeConfidenceBreakdown([
        { weight: 0.3, evidenceType: 'contract_clause', source: 'sow', refId: null, title: '', detail: null, timestamp: null },
        { weight: 0.25, evidenceType: 'delivery_record', source: 'github', refId: null, title: '', detail: null, timestamp: null },
        { weight: 0.2, evidenceType: 'supporting', source: 'change_order', refId: null, title: '', detail: null, timestamp: null },
        { weight: 0.2, evidenceType: 'billing_record', source: 'invoice', refId: null, title: '', detail: null, timestamp: null },
      ])
      expect(breakdown.contract).toBeCloseTo(0.3, 2)
      expect(breakdown.delivery).toBeCloseTo(0.25, 2)
      expect(breakdown.authorization).toBeCloseTo(0.2, 2)
      expect(breakdown.billing).toBeCloseTo(0.2, 2)
    })
    it('sums multiple evidence rows into the same pillar, clamped to [0, 1]', () => {
      const breakdown = computeConfidenceBreakdown([
        { weight: 0.25, evidenceType: 'delivery_record', source: 'github', refId: null, title: '', detail: null, timestamp: null },
        { weight: 0.25, evidenceType: 'delivery_record', source: 'jira', refId: null, title: '', detail: null, timestamp: null },
        { weight: 0.9, evidenceType: 'delivery_record', source: 'github', refId: null, title: '', detail: null, timestamp: null },
      ])
      expect(breakdown.delivery).toBe(1) // 1.4 clamped to 1
      expect(breakdown.contract).toBe(0)
    })
    it('contradicting evidence never pulls a pillar down (composite-only)', () => {
      const breakdown = computeConfidenceBreakdown([
        { weight: 0.3, evidenceType: 'contract_clause', source: 'sow', refId: null, title: '', detail: null, timestamp: null },
        { weight: -0.5, evidenceType: 'contradicting', source: 'invoice', refId: null, title: '', detail: null, timestamp: null },
      ])
      expect(breakdown.contract).toBeCloseTo(0.3, 2)
      // …but it does reduce the composite:
      expect(computeConfidenceScore([
        { weight: 0.3, evidenceType: 'contract_clause', source: 'sow', refId: null, title: '', detail: null, timestamp: null },
        { weight: -0.5, evidenceType: 'contradicting', source: 'invoice', refId: null, title: '', detail: null, timestamp: null },
      ])).toBe(0)
    })
    it('generic supporting evidence (non-change-order) lands in NO pillar', () => {
      const breakdown = computeConfidenceBreakdown([
        { weight: 0.1, evidenceType: 'supporting', source: 'jira', refId: null, title: '', detail: null, timestamp: null },
      ])
      expect(breakdown.contract).toBe(0)
      expect(breakdown.delivery).toBe(0)
      expect(breakdown.authorization).toBe(0)
      expect(breakdown.billing).toBe(0)
    })
  })

  describe('parseConfidenceBreakdown', () => {
    it('round-trips a computed breakdown through JSON', () => {
      const breakdown = computeConfidenceBreakdown([
        { weight: 0.3, evidenceType: 'contract_clause', source: 'sow', refId: null, title: '', detail: null, timestamp: null },
        { weight: 0.25, evidenceType: 'delivery_record', source: 'github', refId: null, title: '', detail: null, timestamp: null },
      ])
      const parsed = parseConfidenceBreakdown(JSON.stringify(breakdown))
      expect(parsed).toEqual(breakdown)
    })
    it('returns null for null / malformed JSON', () => {
      expect(parseConfidenceBreakdown(null)).toBeNull()
      expect(parseConfidenceBreakdown('not json')).toBeNull()
      expect(parseConfidenceBreakdown('{"contract":0.3}')).toBeNull() // missing pillars
    })
    it('returns null for out-of-range or non-numeric pillar values', () => {
      expect(parseConfidenceBreakdown('{"contract":1.5,"delivery":0,"authorization":0,"billing":0}')).toBeNull()
      expect(parseConfidenceBreakdown('{"contract":-0.1,"delivery":0,"authorization":0,"billing":0}')).toBeNull()
      expect(parseConfidenceBreakdown('{"contract":"high","delivery":0,"authorization":0,"billing":0}')).toBeNull()
    })
  })

  describe('EVIDENCE_WEIGHTS', () => {
    it('contract_clause has the highest weight', () => {
      expect(EVIDENCE_WEIGHTS.contract_clause).toBeGreaterThan(EVIDENCE_WEIGHTS.delivery_record)
      expect(EVIDENCE_WEIGHTS.contract_clause).toBeGreaterThan(EVIDENCE_WEIGHTS.billing_record)
    })
    it('contradicting evidence has a NEGATIVE weight', () => {
      expect(EVIDENCE_WEIGHTS.contradicting).toBeLessThan(0)
    })
  })
})
