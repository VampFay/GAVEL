/**
 * Ingestion mappers — turn parsed rows (string-keyed records) into typed
 * records ready for Prisma writes.
 *
 * Design: a declarative field spec per source type (aliases + type +
 * requiredness), so adding a source type is a data change, not control-flow
 * surgery. Header matching is lenient by design — real-world exports spell
 * the same column as "Issue Key", "issue_key", "issuekey", "Key"…
 *
 * Date convention (documented, not guessed silently):
 *   - ISO first: YYYY-MM-DD / full ISO timestamps.
 *   - Then dd/mm/yyyy and dd-mm-yyyy (Indian convention — the product's
 *     home market). Ambiguous d/m vs m/d is resolved day-first; if you
 *     need US-style m/d, export ISO. This is stated in the README and the
 *     upload UI.
 *
 * Invoice lines: rows are grouped by invoice number upstream (route);
 * issueDate may carry forward from a previous row of the SAME invoice
 * (common in accounting exports where the date appears once per invoice).
 */

import type { ParsedFile } from './parse'

export type SourceType = 'jira-tickets' | 'github-commits' | 'invoice-lines'

export const SOURCE_TYPES: SourceType[] = ['jira-tickets', 'github-commits', 'invoice-lines']

export interface RowError {
  row: number
  field: string
  message: string
}

export interface MapResult<T> {
  valid: T[]
  invalid: RowError[]
  totalRows: number
}

// ─────────────────────────── Mapped record types ───────────────────────────

export interface MappedTicket {
  externalId: string
  title: string
  type: string | null
  status: string
  assignee: string | null
  externalCreated: Date | null
  externalUpdated: Date | null
  description: string | null
}

export interface MappedCodeActivity {
  type: string
  ref: string
  title: string
  author: string
  timestamp: Date
  additions: number | null
  deletions: number | null
  filesChanged: number | null
  url: string | null
}

export interface MappedInvoiceLine {
  invoice: string
  issueDate: Date | null
  dueDate: Date | null
  status: string
  currency: string
  description: string
  amount: number
  periodStart: Date | null
  periodEnd: Date | null
}

// ─────────────────────────────── Field specs ───────────────────────────────

type FieldType = 'string' | 'number' | 'date' | 'currency'

interface FieldSpec {
  key: string
  aliases: string[]
  required: boolean
  type: FieldType
  /** For string fields: longest accepted value. */
  maxLength?: number
}

/** Aliases are compared AFTER header normalization (lowercase, alphanumeric only). */
const SPECS: Record<SourceType, FieldSpec[]> = {
  'jira-tickets': [
    { key: 'externalId', aliases: ['key', 'issuekey', 'issue', 'id', 'ticket', 'ticketid', 'ticketkey', 'issueid'], required: true, type: 'string', maxLength: 64 },
    { key: 'title', aliases: ['summary', 'title', 'subject', 'name'], required: true, type: 'string', maxLength: 500 },
    { key: 'type', aliases: ['type', 'issuetype', 'worktype'], required: false, type: 'string', maxLength: 32 },
    { key: 'status', aliases: ['status', 'state', 'workflowstatus'], required: false, type: 'string', maxLength: 32 },
    { key: 'assignee', aliases: ['assignee', 'owner'], required: false, type: 'string', maxLength: 200 },
    { key: 'externalCreated', aliases: ['created', 'createddate', 'createdat', 'opened'], required: false, type: 'date' },
    { key: 'externalUpdated', aliases: ['updated', 'resolved', 'resolutiondate', 'updatedat', 'closed', 'closeddate'], required: false, type: 'date' },
    { key: 'description', aliases: ['description', 'notes'], required: false, type: 'string', maxLength: 10_000 },
  ],
  'github-commits': [
    { key: 'ref', aliases: ['sha', 'commit', 'commithash', 'hash', 'id', 'ref', 'pr', 'prnumber', 'revision'], required: true, type: 'string', maxLength: 64 },
    { key: 'title', aliases: ['message', 'title', 'subject', 'commitmessage', 'summary'], required: true, type: 'string', maxLength: 500 },
    { key: 'author', aliases: ['author', 'authorname', 'committer', 'user'], required: true, type: 'string', maxLength: 200 },
    { key: 'timestamp', aliases: ['date', 'commitdate', 'authoreddate', 'authored', 'timestamp', 'when', 'mergedat', 'closedat'], required: true, type: 'date' },
    { key: 'type', aliases: ['type', 'activitytype', 'kind'], required: false, type: 'string', maxLength: 16 },
    { key: 'additions', aliases: ['additions', 'insertions', 'linesadded'], required: false, type: 'number' },
    { key: 'deletions', aliases: ['deletions', 'linesdeleted'], required: false, type: 'number' },
    { key: 'filesChanged', aliases: ['fileschanged', 'files', 'filesaffected'], required: false, type: 'number' },
    { key: 'url', aliases: ['url', 'link', 'href'], required: false, type: 'string', maxLength: 500 },
  ],
  'invoice-lines': [
    { key: 'invoice', aliases: ['invoice', 'invoicenumber', 'invoiceno', 'invoicenum', 'invoiceid', 'billno', 'documentno'], required: true, type: 'string', maxLength: 64 },
    { key: 'description', aliases: ['description', 'item', 'details', 'narrative', 'lineitem', 'particulars', 'service'], required: true, type: 'string', maxLength: 500 },
    { key: 'amount', aliases: ['amount', 'total', 'linetotal', 'value', 'price', 'net'], required: true, type: 'currency' },
    { key: 'issueDate', aliases: ['issuedate', 'invoicedate', 'issued', 'date', 'billdate'], required: false, type: 'date' },
    { key: 'dueDate', aliases: ['duedate', 'due', 'paymentdue'], required: false, type: 'date' },
    { key: 'status', aliases: ['status', 'state'], required: false, type: 'string', maxLength: 32 },
    { key: 'currency', aliases: ['currency', 'curr', 'currencycode'], required: false, type: 'string', maxLength: 8 },
    { key: 'periodStart', aliases: ['periodstart', 'from', 'startdate', 'serviceperiodstart'], required: false, type: 'date' },
    { key: 'periodEnd', aliases: ['periodend', 'to', 'enddate', 'serviceperiodend'], required: false, type: 'date' },
  ],
}

// ─────────────────────────────── Coercion ───────────────────────────────

/** Strip currency symbols, thousands separators and whitespace, then parse. */
export function coerceNumber(raw: string): number | null {
  if (!raw) return null
  const cleaned = raw.replace(/[₹$€£,\s]/g, '').replace(/^\((.*)\)$/, '-$1')
  if (cleaned === '' || cleaned === '-') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/
const DMY_RE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/

/**
 * Coerce a date. ISO first, then dd/mm/yyyy (day-first, Indian
 * convention). Returns null for unparseable values.
 */
export function coerceDate(raw: string): Date | null {
  if (!raw) return null
  const s = raw.trim()
  if (ISO_RE.test(s)) {
    const d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const dmy = s.match(DMY_RE)
  if (dmy) {
    const day = Number(dmy[1])
    const month = Number(dmy[2])
    const year = Number(dmy[3])
    // Day-first resolution. Reject impossible calendar dates.
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    const d = new Date(Date.UTC(year, month - 1, day))
    // Guard rollover (e.g. 31/02/2025 silently becoming 03/03).
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
      return null
    }
    return d
  }
  return null
}

// ─────────────────────────────── Mapping ───────────────────────────────

function resolveColumn(headers: string[], spec: FieldSpec): string | null {
  // Exact alias match first…
  for (const alias of spec.aliases) {
    if (headers.includes(alias)) return alias
  }
  // …then alias-as-prefix (e.g. "issuekey1" for repeated Jira export columns).
  for (const alias of spec.aliases) {
    const hit = headers.find(h => h.startsWith(alias) && h.length > alias.length)
    if (hit) return hit
  }
  return null
}

function coerceField(spec: FieldSpec, value: string): unknown | null {
  switch (spec.type) {
    case 'string':
      return value === '' ? null : value
    case 'number': {
      if (value === '') return null
      const n = coerceNumber(value)
      return n !== null && Number.isInteger(n) ? n : null
    }
    case 'currency': {
      if (value === '') return null
      return coerceNumber(value)
    }
    case 'date':
      return coerceDate(value)
  }
}

/**
 * Map parsed rows against a source type's field spec.
 * Collects per-row field errors instead of failing the whole file — one
 * bad row shouldn't throw away 999 good ones. Rows with a missing required
 * column value are invalid; rows with unparseable optional values are
 * invalid too (silent data loss is worse than a rejected row).
 */
export function mapRows(parsed: ParsedFile, sourceType: SourceType): MapResult<Record<string, unknown>> {
  const specs = SPECS[sourceType]
  const headers = parsed.headers
  const columnFor = new Map<FieldSpec, string | null>()
  for (const spec of specs) columnFor.set(spec, resolveColumn(headers, spec))

  // A required column that isn't present AT ALL is a file-level problem —
  // report it once, on row 0, and mark every row invalid.
  const missingColumns = specs.filter(s => s.required && columnFor.get(s) === null)
  if (missingColumns.length > 0) {
    return {
      valid: [],
      invalid: parsed.rows.map((_, i) => ({
        row: i + 1,
        field: missingColumns[0]?.key ?? '?',
        message: `required column missing from file: ${missingColumns.map(s => s.aliases[0]).join(', ')}`,
      })),
      totalRows: parsed.rows.length,
    }
  }

  const valid: Record<string, unknown>[] = []
  const invalid: RowError[] = []

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i] as Record<string, string>
    const out: Record<string, unknown> = {}
    let rowOk = true
    for (const spec of specs) {
      const col = columnFor.get(spec)
      const raw = col !== null && col !== undefined ? (row[col] ?? '') : ''
      if (spec.required && raw === '') {
        invalid.push({ row: i + 1, field: spec.key, message: `${spec.key} is required` })
        rowOk = false
        continue
      }
      if (raw === '') {
        out[spec.key] = null
        continue
      }
      const coerced = coerceField(spec, raw)
      if (coerced === null) {
        invalid.push({
          row: i + 1,
          field: spec.key,
          message: spec.type === 'date'
            ? `unparseable date "${raw}" (use ISO YYYY-MM-DD or dd/mm/yyyy)`
            : spec.type === 'currency' || spec.type === 'number'
              ? `unparseable number "${raw}"`
              : `invalid value "${raw}"`,
        })
        rowOk = false
        continue
      }
      if (spec.maxLength !== undefined && typeof coerced === 'string' && coerced.length > spec.maxLength) {
        invalid.push({ row: i + 1, field: spec.key, message: `${spec.key} longer than ${spec.maxLength} chars` })
        rowOk = false
        continue
      }
      out[spec.key] = coerced
    }
    if (rowOk) valid.push(out)
  }

  return { valid, invalid, totalRows: parsed.rows.length }
}

// ─────────────────────── Source-type post-processing ───────────────────────

const TICKET_TYPES = new Set(['story', 'bug', 'task', 'epic', 'subtask', 'spike', 'chore'])
const ACTIVITY_TYPES = new Set(['commit', 'pr', 'merge', 'deploy'])
const INVOICE_STATUSES = new Set(['draft', 'issued', 'paid', 'overdue', 'void'])

export function mapTickets(parsed: ParsedFile): MapResult<MappedTicket> {
  const base = mapRows(parsed, 'jira-tickets')
  const valid = base.valid.map(r => ({
    externalId: String(r.externalId),
    title: String(r.title),
    type: typeof r.type === 'string' && TICKET_TYPES.has(r.type.toLowerCase())
      ? r.type.toLowerCase()
      : null,
    status: typeof r.status === 'string' && r.status !== ''
      ? r.status.toLowerCase().replace(/\s+/g, '_')
      : 'todo',
    assignee: (r.assignee as string | null) ?? null,
    externalCreated: (r.externalCreated as Date | null) ?? null,
    externalUpdated: (r.externalUpdated as Date | null) ?? null,
    description: (r.description as string | null) ?? null,
  }))
  return { valid, invalid: base.invalid, totalRows: base.totalRows }
}

export function mapCodeActivities(parsed: ParsedFile): MapResult<MappedCodeActivity> {
  const base = mapRows(parsed, 'github-commits')
  const valid = base.valid.map(r => ({
    type: typeof r.type === 'string' && ACTIVITY_TYPES.has(r.type.toLowerCase())
      ? r.type.toLowerCase()
      : 'commit',
    ref: String(r.ref),
    title: String(r.title),
    author: String(r.author),
    timestamp: r.timestamp as Date,
    additions: (r.additions as number | null) ?? null,
    deletions: (r.deletions as number | null) ?? null,
    filesChanged: (r.filesChanged as number | null) ?? null,
    url: (r.url as string | null) ?? null,
  }))
  return { valid, invalid: base.invalid, totalRows: base.totalRows }
}

export function mapInvoiceLines(parsed: ParsedFile): MapResult<MappedInvoiceLine> {
  const base = mapRows(parsed, 'invoice-lines')
  // Carry issueDate/dueDate/status/currency forward within the same invoice
  // number — accounting exports often state them once per invoice block.
  const carry = new Map<string, { issueDate: Date | null; dueDate: Date | null; status: string | null; currency: string | null }>()
  const valid: MappedInvoiceLine[] = []
  for (const r of base.valid) {
    const invoice = String(r.invoice)
    const prev = carry.get(invoice)
    const issueDate = (r.issueDate as Date | null) ?? prev?.issueDate ?? null
    const dueDate = (r.dueDate as Date | null) ?? prev?.dueDate ?? null
    const status =
      typeof r.status === 'string' && INVOICE_STATUSES.has(r.status.toLowerCase())
        ? r.status.toLowerCase()
        : prev?.status ?? 'issued'
    const currency =
      typeof r.currency === 'string' && r.currency !== '' ? r.currency.toUpperCase() : prev?.currency ?? 'INR'
    carry.set(invoice, { issueDate, dueDate, status, currency })
    valid.push({
      invoice,
      issueDate,
      dueDate,
      status,
      currency,
      description: String(r.description),
      amount: r.amount as number,
      periodStart: (r.periodStart as Date | null) ?? null,
      periodEnd: (r.periodEnd as Date | null) ?? null,
    })
  }
  return { valid, invalid: base.invalid, totalRows: base.totalRows }
}

/**
 * Group invoice lines by invoice number, preserving first-seen order.
 * Each group becomes one Invoice + its InvoiceLine rows.
 */
export function groupInvoices(lines: MappedInvoiceLine[]): Map<string, MappedInvoiceLine[]> {
  const groups = new Map<string, MappedInvoiceLine[]>()
  for (const line of lines) {
    const key = line.invoice.trim().toUpperCase()
    const bucket = groups.get(key)
    if (bucket) bucket.push(line)
    else groups.set(key, [line])
  }
  return groups
}

/**
 * Human-facing documentation of expected columns — surfaced by the API
 * (dryRun errors) and rendered in the upload UI so users never have to
 * guess the format contract.
 */
export function expectedColumns(sourceType: SourceType): string[] {
  return SPECS[sourceType].map(s => `${s.aliases[0]}${s.required ? '' : ' (optional)'}`)
}
