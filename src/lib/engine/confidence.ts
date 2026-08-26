import type { EngineEvidence, FindingDraft } from './types'

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
 * Compute the composite confidence score for a finding's evidence list.
 * Sum of evidence weights, clamped to [0, 1].
 */
export function computeConfidenceScore(evidence: EngineEvidence[]): number {
  let raw = 0
  for (const e of evidence) {
    raw += e.weight
  }
  if (raw < 0) return 0
  if (raw > 1) return 1
  return Math.round(raw * 100) / 100
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
 * Convenience: stamp a FindingDraft with computed confidenceScore + bucket.
 * Call this from each rule before returning the draft.
 */
export function stampConfidence(draft: Omit<FindingDraft, 'confidence' | 'confidenceScore'>): FindingDraft {
  const score = computeConfidenceScore(draft.evidence)
  return {
    ...draft,
    confidenceScore: score,
    confidence: bucketConfidence(score),
  }
}
