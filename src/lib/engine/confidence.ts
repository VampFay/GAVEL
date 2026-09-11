import type { ConfidenceBreakdown, EngineEvidence, FindingDraft } from './types'

/**
 * Confidence decomposition — §9.4 of the plan.
 *
 * Each finding has a confidence score in [0, 1] derived from its evidence.
 * Each piece of evidence carries a `weight` (its contribution to the
 * composite). The composite is `sum(weights)`, clamped to [0, 1].
 *
 * The "weight" of each evidence type is hand-tuned today (per the plan —
 * don't reach for a learned model before you have labeled outcomes
 * approved/dismissed findings to train on). The rubric:
 *
 *   contract_clause   : 0.30 — a SOW clause explicitly addressing the
 *                              issue is the strongest signal.
 *   delivery_record   : 0.25 — code/ticket evidence that the work was done.
 *                              FULL weight only for STRONG links (explicit
 *                              milestone-ID mention). WEAK links (fuzzy
 *                              2-token description overlap) are capped at
 *                              WEAK_DELIVERY_WEIGHT_CAP = 0.10 — a fuzzy
 *                              match must never be able to lift a finding
 *                              into the HIGH bucket that an explicit ID
 *                              mention earns (audit v3, engine finding #1:
 *                              weak and strong both weighted 0.25 reached
 *                              identical HIGH composites).
 *   billing_record    : 0.20 — an invoice (or absence) is structural
 *                              evidence about whether the work was billed.
 *   change_order     : 0.20 — presence/absence of a signed change order.
 *   supporting       : 0.10 — corroborating context.
 *   contradicting    : -0.20 — pulls the score DOWN; e.g. an invoice
 *                               that contradicts a "missing invoice" claim.
 *
 * Findings are bucketed into HIGH / MEDIUM / LOW by composite score:
 *   >= 0.70 → HIGH
 *   >= 0.45 → MEDIUM
 *   < 0.45 → LOW
 *
 * Rule authors override weights at the evidence-row level when the rule
 * has stronger / weaker belief in a specific piece of evidence (e.g. a
 * commit title that explicitly says "out of baseline scope" weighs more
 * than a generic commit).
 */

export const EVIDENCE_WEIGHTS = {
  contract_clause: 0.30,
  delivery_record: 0.25,
  billing_record: 0.20,
  change_order: 0.20,
  supporting: 0.10,
  contradicting: -0.20,
} as const

/**
 * Ceiling for WEAK delivery links (fuzzy description-overlap matches) in
 * the confidence composite. See EVIDENCE_WEIGHTS above for the rationale.
 */
export const WEAK_DELIVERY_WEIGHT_CAP = 0.10

/**
 * The weight an evidence row actually contributes to the composite.
 * Weakly-linked delivery rows are clamped to WEAK_DELIVERY_WEIGHT_CAP;
 * everything else contributes its declared weight. Single choke point —
 * rules CAN'T accidentally over-credit a fuzzy match by passing a fat
 * weight, the cap is enforced here.
 */
export function effectiveWeight(e: EngineEvidence): number {
  if (
    e.evidenceType === 'delivery_record' &&
    e.matchStrength === 'weak' &&
    e.weight > WEAK_DELIVERY_WEIGHT_CAP
  ) {
    return WEAK_DELIVERY_WEIGHT_CAP
  }
  return e.weight
}

/**
 * Compute the composite confidence score for a finding's evidence list.
 * Sum of evidence weights, clamped to [0, 1].
 */
export function computeConfidenceScore(evidence: EngineEvidence[]): number {
  let raw = 0
  for (const e of evidence) {
    raw += effectiveWeight(e)
  }
  if (raw < 0) return 0
  if (raw > 1) return 1
  return Math.round(raw * 100) / 100
}

// ─────────────────────── Pillar decomposition (§9.4) ───────────────────────

/**
 * Map an evidence row to the confidence pillar it supports, or null if it
 * doesn't belong to a pillar (generic `supporting` context and
 * `contradicting` evidence affect only the composite, never a pillar).
 *
 * Note on authorization: change-order evidence is currently typed
 * `supporting` with source `change_order` (see the rules) — the pillar
 * mapping keys on BOTH fields so it lands in the right bucket.
 */
function pillarOf(e: EngineEvidence): keyof ConfidenceBreakdown | null {
  switch (e.evidenceType) {
    case 'contract_clause':
      return 'contract'
    case 'delivery_record':
      return 'delivery'
    case 'billing_record':
      return 'billing'
    case 'supporting':
      return e.source === 'change_order' ? 'authorization' : null
    default:
      return null // contradicting + anything else: composite-only
  }
}

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return Math.round(n * 100) / 100
}

/**
 * Compute the per-pillar confidence sub-scores for a finding's evidence.
 * Each pillar = sum of the POSITIVE weights of its evidence rows, clamped
 * to [0, 1]. Negative (contradicting) weights never pull a pillar below
 * zero — they reduce the composite, and the reviewer sees them as
 * contradicting rows in the evidence list.
 */
export function computeConfidenceBreakdown(evidence: EngineEvidence[]): ConfidenceBreakdown {
  const sums: ConfidenceBreakdown = {
    contract: 0,
    delivery: 0,
    authorization: 0,
    billing: 0,
  }
  for (const e of evidence) {
    const pillar = pillarOf(e)
    if (pillar === null) continue
    const w = effectiveWeight(e)
    if (w > 0) sums[pillar] += w
  }
  return {
    contract: clamp01(sums.contract),
    delivery: clamp01(sums.delivery),
    authorization: clamp01(sums.authorization),
    billing: clamp01(sums.billing),
  }
}

/**
 * Parse the persisted `Finding.confidenceBreakdown` JSON string back into a
 * ConfidenceBreakdown object (at the API response boundary). Returns null
 * for null/unparseable/shape-invalid values — legacy and manually-created
 * findings have no stored breakdown, and the UI falls back to synthesizing
 * one from the evidence weights.
 */
export function parseConfidenceBreakdown(raw: string | null): ConfidenceBreakdown | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const p = parsed as Record<string, unknown>
    const pillars = ['contract', 'delivery', 'authorization', 'billing'] as const
    const out: Partial<ConfidenceBreakdown> = {}
    for (const pillar of pillars) {
      const v = p[pillar]
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) return null
      out[pillar] = v
    }
    return out as ConfidenceBreakdown
  } catch {
    return null
  }
}

/**
 * Map a composite score to a HIGH / MEDIUM / LOW bucket.
 */
export function bucketConfidence(score: number): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (score >= 0.7) return 'HIGH'
  if (score >= 0.45) return 'MEDIUM'
  return 'LOW'
}

/**
 * Convenience: stamp a FindingDraft with computed confidenceScore + bucket
 * + per-pillar breakdown. Call this from each rule before returning the draft.
 */
export function stampConfidence(
  draft: Omit<FindingDraft, 'confidence' | 'confidenceScore' | 'confidenceBreakdown'>
): FindingDraft {
  const score = computeConfidenceScore(draft.evidence)
  return {
    ...draft,
    confidenceScore: score,
    confidence: bucketConfidence(score),
    confidenceBreakdown: computeConfidenceBreakdown(draft.evidence),
  }
}
