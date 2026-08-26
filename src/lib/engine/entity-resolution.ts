import type {
  EngineCodeActivity,
  EngineExclusion,
  EngineInput,
  EngineInvoice,
  EngineInvoiceLine,
  EngineLineItem,
  EngineMilestone,
  EngineTicket,
} from './types'

/**
 * Entity resolution — §9.1 of the plan (DETERMINISTIC half only).
 *
 * The job: link delivery records (Jira tickets, GitHub PRs/commits) and
 * billing records (invoices, change orders) to the right contract structure
 * (milestones, line items, exclusions). The engine's rules need this
 * linkage to ask "is this milestone delivered?" and "is it invoiced?".
 *
 * The deterministic half covers:
 *   - Explicit externalId references in commit/PR titles (e.g. "M4",
 *     "ENG-131", "#284")
 *   - Milestone ID mentions in invoice line descriptions
 *   - Range parsing for caps ("records 50,001–87,000")
 *
 * The fuzzy half (semantic similarity between loosely-worded ticket titles
 * and contract line items) requires pgvector and an embeddings model —
 * deferred until the Postgres migration (see audit P2-2).
 *
 * All functions here are PURE — no DB access. The route handler reads
 * the raw rows and passes them in.
 */

// ──────────────────────────── Milestone linking ────────────────────────

/**
 * Find a milestone by its externalId (e.g. "M1", "M2"). Case-insensitive.
 * Returns null if not found or if the milestone has no externalId.
 */
export function findMilestoneByExternalId(
  milestones: EngineMilestone[],
  externalId: string
): EngineMilestone | null {
  if (!externalId) return null
  const lower = externalId.toLowerCase()
  for (const m of milestones) {
    if (m.externalId && m.externalId.toLowerCase() === lower) return m
  }
  return null
}

/**
 * Find delivery evidence for a milestone. A milestone is considered
 * "delivered" if EITHER:
 *
 *   (a) STRONG match: a code activity (PR/commit/merge) title explicitly
 *       mentions the milestone's externalId (e.g. "M4" in the title).
 *       One externalId mention is sufficient.
 *
 *   (b) WEAK match: a code activity's title shares >= 2 significant
 *       tokens with the milestone's DESCRIPTION (e.g. PR titled
 *       "Telemedicine WebRTC integration" shares "telemedicine" +
 *       "integration" with M4's description "Telemedicine integration").
 *       Requires 2+ shared tokens to reduce false positives — a single
 *       shared generic word ("auth", "api") is not enough.
 *
 * Tickets are matched by externalId-in-title OR description-inclusion only
 * (tickets rarely restate the milestone description).
 *
 * Returns the matching code activities (PRs/commits) and tickets — these
 * become `delivery_record` evidence rows in the resulting finding.
 */
export function findMilestoneDelivery(
  milestone: EngineMilestone,
  ctx: { codeActivities: EngineCodeActivity[]; tickets: EngineTicket[] }
): { activities: EngineCodeActivity[]; tickets: EngineTicket[] } {
  if (!milestone.externalId) return { activities: [], tickets: [] }
  const needle = milestone.externalId.toLowerCase()

  // Strong match: externalId mentioned in the title.
  const activities = ctx.codeActivities.filter(a =>
    a.title.toLowerCase().includes(needle)
  )

  // Weak match: >= 2 shared significant tokens with the milestone description.
  // Only consider activities NOT already matched by externalId.
  const descTokens = new Set(tokenize(milestone.description))
  for (const a of ctx.codeActivities) {
    if (activities.includes(a)) continue // already matched strongly
    const titleTokens = tokenize(a.title)
    const shared = titleTokens.filter(t => descTokens.has(t))
    // Dedupe shared tokens (title may repeat a token).
    const distinctShared = new Set(shared)
    if (distinctShared.size >= 2) activities.push(a)
  }

  const tickets = ctx.tickets.filter(t =>
    t.title.toLowerCase().includes(needle) ||
    (t.description?.toLowerCase().includes(needle) ?? false)
  )
  return { activities, tickets }
}

/**
 * Find billing evidence for a milestone — an invoice line whose
 * description explicitly mentions the milestone's externalId.
 *
 * Returns the matching invoice lines + their parent invoices.
 */
export function findMilestoneBilling(
  milestone: EngineMilestone,
  invoices: EngineInvoice[]
): { lines: Array<{ line: EngineInvoiceLine; invoice: EngineInvoice }> } {
  if (!milestone.externalId) return { lines: [] }
  const needle = milestone.externalId.toLowerCase()
  const lines: Array<{ line: EngineInvoiceLine; invoice: EngineInvoice }> = []
  for (const inv of invoices) {
    for (const line of inv.lines) {
      if (line.description.toLowerCase().includes(needle)) {
        lines.push({ line, invoice: inv })
      }
    }
  }
  return { lines }
}

// ──────────────────────────── Ticket / commit linking ──────────────────

const TICKET_REF_RE = /\b([A-Z][A-Z0-9_]+)-(\d+)\b/g

/**
 * Extract ticket references from a string (e.g. PR title).
 * Returns an array of normalized ticket externalIds like "ENG-131".
 */
export function extractTicketRefs(text: string): string[] {
  const refs: string[] = []
  for (const m of text.matchAll(TICKET_REF_RE)) {
    const ref = m[1] && m[2] ? `${m[1]}-${m[2]}` : null
    if (ref && !refs.includes(ref)) refs.push(ref)
  }
  return refs
}

/**
 * Find a ticket by its externalId. Case-sensitive (Jira-style: ENG-131).
 */
export function findTicketByExternalId(
  tickets: EngineTicket[],
  externalId: string
): EngineTicket | null {
  for (const t of tickets) {
    if (t.externalId === externalId) return t
  }
  return null
}

// ──────────────────────────── Cap / range parsing ──────────────────────

/**
 * Detect whether a line item description encodes a quantity cap.
 * Heuristic: looks for "cap", "limit", "maximum" + a number.
 * Returns the cap value or null.
 *
 * Example matches:
 *   "Legacy patient records migration (cap: 50,000 records)" → 50000
 *   "Migration limit: 50000 records" → 50000
 *   "Senior engineer hours" → null (no cap)
 */
export function detectQuantityCap(desc: string): number | null {
  // Match (cap|limit|maximum) followed by an optional colon / "=" then a number
  const re = /\b(cap|limit|maximum)\s*[:=]?\s*([0-9][0-9,]*)\b/i
  const m = desc.match(re)
  if (!m || !m[2]) return null
  const n = Number(m[2].replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Extract a numeric range "X–Y" or "X-Y" from a string (e.g. commit title).
 * Returns the [start, end] pair (with start < end) or null.
 *
 * Example matches:
 *   "Legacy record migration — closes ENG-155 (records 50,001–87,000)"
 *     → [50001, 87000]
 *   "WCAG 2.1 AA remediation pass — closes ENG-158" → null
 */
export function extractNumericRange(text: string): [number, number] | null {
  // Match numbers separated by – (en-dash), — (em-dash), or - (hyphen).
  // Whitespace and thousands separators tolerated.
  const re = /([0-9][0-9,]*)\s*[–—-]\s*([0-9][0-9,]*)/
  const m = text.match(re)
  if (!m || !m[1] || !m[2]) return null
  const a = Number(m[1].replace(/,/g, ''))
  const b = Number(m[2].replace(/,/g, ''))
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return a < b ? [a, b] : [b, a]
}

// ──────────────────────────── Exclusion keyword match ──────────────────

/**
 * Tokenize a string into normalized lowercase keywords, dropping
 * stopwords + short tokens. Used for deterministic keyword overlap
 * between an exclusion description and a ticket/commit title.
 *
 * This is the deterministic fallback for §9.1's fuzzy half. Once
 * pgvector lands, replace with cosine similarity over embeddings.
 */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'if', 'in',
  'into', 'is', 'it', 'no', 'not', 'of', 'on', 'or', 'such', 'that', 'the',
  'their', 'then', 'there', 'these', 'they', 'this', 'to', 'was', 'will',
  'with', 'beyond', 'per', 'scope', 'out', 'above', 'work', 'separately',
  'billed', 'count', 'side', 'each', 'more', 'most', 'some', 'only', 'own',
  'same', 'than', 'too', 'very', 'just', 'new', 'all', 'any', 'both',
])

export function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const tokens = lower.match(/[a-z][a-z0-9]+/g) ?? []
  return tokens.filter(t => t.length >= 3 && !STOPWORDS.has(t))
}

/**
 * Compute the set of distinct tokens shared between two strings.
 * Returns the overlap as an array (no duplicates).
 */
export function sharedTokens(a: string, b: string): string[] {
  const aTokens = new Set(tokenize(a))
  const bTokens = tokenize(b)
  const shared: string[] = []
  const seen = new Set<string>()
  for (const t of bTokens) {
    if (aTokens.has(t) && !seen.has(t)) {
      shared.push(t)
      seen.add(t)
    }
  }
  return shared
}

/**
 * Heuristic: does a delivery record (ticket / commit title) match an
 * exclusion (e.g. "Backend hospital EMR customization is NOT in scope")?
 *
 * Returns the shared keyword tokens if there's meaningful overlap, or
 * null if not.
 *
 * Threshold: requires at least 1 shared token of >= 3 chars. The tokenizer
 * already drops stopwords + 1-2-char tokens, so any shared token here is
 * at least 3 chars. 3 is the right floor because domain acronyms like
 * "EMR", "SSO", "API", "DWH" are 3 chars and are exactly the strong
 * signals we want to catch. (A 4-char floor would miss these.)
 */
export function matchExclusionToDelivery(
  exclusion: EngineExclusion,
  deliveryTitle: string
): string[] | null {
  const shared = sharedTokens(exclusion.description, deliveryTitle)
  if (shared.length === 0) return null
  return shared
}

// ──────────────────────────── Helpers ──────────────────────────────────

/** Find line items that mention a milestone externalId. */
export function findLineItemsForMilestone(
  lineItems: EngineLineItem[],
  milestoneExternalId: string
): EngineLineItem[] {
  if (!milestoneExternalId) return []
  const lower = milestoneExternalId.toLowerCase()
  return lineItems.filter(li => li.milestone?.toLowerCase() === lower)
}

/** Compute days between two dates (b - a), as a signed integer. */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24))
}
