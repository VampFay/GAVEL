export type FindingType =
  | 'missed_milestone'
  | 'unbilled_overage'
  | 'scope_expansion'
  | 'rate_discrepancy'
  | 'unauthorized_work'

/**
 * Short human-readable label for each finding type (matches the schema's
 * `type` enum and the UI's `findingTypeLabel` in src/lib/gavel.ts).
 * Kept here so the engine doesn't depend on the React layer.
 */
export const FINDING_TYPE_LABELS: Record<FindingType, string> = {
  missed_milestone: 'Missed milestone',
  unbilled_overage: 'Unbilled overage',
  scope_expansion: 'Scope expansion',
  rate_discrepancy: 'Rate discrepancy',
  unauthorized_work: 'Unauthorized work',
}
