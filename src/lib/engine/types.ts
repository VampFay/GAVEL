import type { Prisma } from '@prisma/client'
import type { FindingType } from './finding-types'

/**
 * Engine — input/output types.
 *
 * The engine is a pure function: it takes a snapshot of contract + delivery
 * + billing records (read by the route handler) and produces a list of
 * `FindingDraft`s + their evidence. The route handler is responsible for
 * persisting these as `Finding` rows in the DB (idempotently — see
 * src/lib/engine/index.ts).
 *
 * Why pure? Two reasons:
 *   1. Testable without spinning up Prisma — see tests/unit/engine.test.ts.
 *   2. The Postgres/pgvector migration can swap the data source without
 *      touching the engine's logic.
 *
 * §9 of the product plan:
 *   §9.1 Entity resolution — link delivery records to contract line items
 *        + milestones. The deterministic half lives in entity-resolution.ts;
 *        the embedding-based "fuzzy" half is deferred until the Postgres
 *        migration lands (see audit P2-2).
 *   §9.3 Rules — missed_milestone, unbilled_overage, scope_expansion.
 *   §9.4 Confidence — weighted rubric (sum of evidence weights, clamped
 *        to [0, 1]).
 */

// ──────────────────────────────── Inputs ────────────────────────────────

/** Prisma Decimal for type compatibility. */
type Decimal = Prisma.Decimal

export interface EngineMilestone {
  id: string          // DB id
  externalId: string | null  // e.g. "M1"
  description: string
  dueDate: Date | null
  value: Decimal | null
  currency: string
}

export interface EngineLineItem {
  id: string
  description: string
  rate: Decimal | null
  rateUnit: string | null
  quantity: number | null
  milestone: string | null   // externalId reference
  deliveryDate: Date | null
}

export interface EngineExclusion {
  id: string
  clause: string | null
  description: string
}

export interface EngineTicket {
  id: string
  externalId: string        // e.g. ENG-101
  title: string
  type: string | null       // story|bug|task|epic
  status: string            // todo|in_progress|done|closed
  assignee: string | null
  externalCreated: Date | null
  externalUpdated: Date | null
  description: string | null
}

export interface EngineCodeActivity {
  id: string
  type: string              // commit|pr|merge|deploy
  ref: string               // commit sha or PR number
  title: string
  author: string
  timestamp: Date
  additions: number | null
  deletions: number | null
  filesChanged: number | null
  url: string | null
}

export interface EngineInvoice {
  id: string
  number: string
  issueDate: Date
  dueDate: Date | null
  status: string
  total: Decimal
  currency: string
  lines: EngineInvoiceLine[]
}

export interface EngineInvoiceLine {
  id: string
  description: string
  amount: Decimal
  periodStart: Date | null
  periodEnd: Date | null
}

export interface EngineChangeOrder {
  id: string
  title: string
  description: string
  value: Decimal | null
  signedDate: Date | null
}

export interface EngineInput {
  contractId: string
  contractTitle: string
  currency: string
  milestones: EngineMilestone[]
  lineItems: EngineLineItem[]
  exclusions: EngineExclusion[]
  changeOrders: EngineChangeOrder[]
  tickets: EngineTicket[]
  codeActivities: EngineCodeActivity[]
  invoices: EngineInvoice[]
}

// ──────────────────────────────── Outputs ───────────────────────────────

export type EvidenceType =
  | 'contract_clause'
  | 'delivery_record'
  | 'billing_record'
  | 'supporting'
  | 'contradicting'

export type EvidenceSource =
  | 'sow'
  | 'jira'
  | 'github'
  | 'gitlab'
  | 'invoice'
  | 'change_order'

export interface EngineEvidence {
  evidenceType: EvidenceType
  source: EvidenceSource
  refId: string | null
  title: string
  detail: string | null
  timestamp: Date | null
  /**
   * Weight contribution to the finding's composite confidence score.
   * Sum of all evidence weights in a finding = raw score, clamped to [0, 1].
   * See src/lib/engine/confidence.ts.
   */
  weight: number
}

/**
 * The four evidence pillars a finding's confidence decomposes into
 * (the plan's UI mock: Contract 92% / Delivery 97% / Authorization 88% /
 * Billing 100% — "decomposed, not magical"). Each pillar score is the sum
 * of the positive weights of the evidence rows belonging to that pillar,
 * clamped to [0, 1]. Computed in confidence.ts, persisted on Finding as a
 * JSON string, rendered by the finding-detail UI.
 */
export interface ConfidenceBreakdown {
  contract: number      // contract_clause evidence — how clearly the SOW speaks to this issue
  delivery: number      // delivery_record evidence — how strongly the code/ticket record shows the work happened
  authorization: number // change-order evidence — whether a signed CO covers (or fails to cover) the work
  billing: number       // billing_record evidence — what the invoice record confirms/denies
}

export interface FindingDraft {
  /** Logical key — used for idempotent upsert (persisted as Finding.signature). */
  signature: string
  type: FindingType
  title: string
  summary: string
  impactAmount: number | null  // INR value at stake (null = unknown / TBD)
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  confidenceScore: number     // 0.0–1.0 composite
  confidenceBreakdown: ConfidenceBreakdown // per-pillar sub-scores (§9.4)
  assessment: 'billable' | 'already_covered' | 'ambiguous'
  recommendedAction: 'approve' | 'dismiss' | 'request_review' | 'draft_change_order'
  contractClause: string | null
  billingState: string | null
  evidence: EngineEvidence[]
}

export interface RuleResult {
  rule: FindingType
  findings: FindingDraft[]
  /** Stats for the rule — counts of records scanned, etc. Useful for logging. */
  stats: {
    scanned: number
    considered: number
    emitted: number
  }
}

export interface EngineOutput {
  findings: FindingDraft[]
  ruleStats: Record<string, RuleResult['stats']>
}

// ─────────────────────────────── Rule contract ─────────────────────────

export interface RuleContext {
  input: EngineInput
  /** Today, parameterized for deterministic tests. */
  now: Date
}

export interface Rule {
  type: FindingType
  run(ctx: RuleContext): RuleResult
}
