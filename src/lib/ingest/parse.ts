/**
 * Ingestion parser — CSV (RFC 4180 subset) and JSON.
 *
 * Zero new dependencies by design: the upload format contract is small
 * (header row + string cells), so a hand-rolled parser is ~60 lines and
 * fully testable. If requirements ever grow to real Excel/xlsx, pull in a
 * proper library THEN — not speculatively.
 *
 * What this deliberately is NOT:
 *   - A full RFC 4180 implementation (no NUL bytes, no unicode line breaks
 *     inside quoted fields). Real-world Jira/GitHub/accounting CSV exports
 *     are within this subset.
 *   - Streaming. Files are capped at 2 MB / 2,500 rows by the route, so
 *     buffering the whole text is fine.
 *
 * Hard limits enforced here (not just at the route) so the parser can never
 * be used to blow memory even if wired to a different entry point:
 *   MAX_FIELD_LEN 10,000 chars · MAX_COLS 100 · MAX_ROWS 2,500
 */

export const MAX_FIELD_LEN = 10_000
export const MAX_COLS = 100
export const MAX_ROWS = 2_500

export interface ParseError {
  row: number
  message: string
}

export interface ParsedFile {
  format: 'csv' | 'json'
  /** Normalized (lowercase, alphanumeric-only) header keys, in order. */
  headers: string[]
  /** Row objects keyed by normalized header. Values are strings ('' for blank). */
  rows: Record<string, string>[]
  /** Structural errors — individual unparseable rows / JSON shape issues. */
  errors: ParseError[]
}

/** Normalize a header: lowercase, strip everything non-alphanumeric. */
export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '')
}

// ─────────────────────────────── CSV ───────────────────────────────

/**
 * Parse CSV text into a matrix of cells.
 * Handles: quoted fields, doubled-quote escapes, embedded commas/newlines
 * inside quotes, CRLF and LF line endings, a leading UTF-8 BOM, and a
 * trailing newline. Skips fully-empty lines (outside quotes).
 */
export function parseCsvMatrix(text: string): string[][] {
  const src = text.startsWith('\uFEFF') ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  const pushField = () => {
    if (field.length > MAX_FIELD_LEN) {
      throw new ParseLimitError(`field exceeds ${MAX_FIELD_LEN} characters`)
    }
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    pushField()
    // Skip rows that are entirely empty (blank line / CR-only artifact).
    const isEmpty = row.every(c => c === '')
    if (!isEmpty) {
      if (row.length > MAX_COLS) {
        throw new ParseLimitError(`row exceeds ${MAX_COLS} columns`)
      }
      if (rows.length >= MAX_ROWS) {
        throw new ParseLimitError(`file exceeds ${MAX_ROWS} rows`)
      }
      rows.push(row)
    }
    row = []
  }

  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      pushField()
    } else if (ch === '\n') {
      pushRow()
    } else if (ch === '\r') {
      // Swallow CR — the following LF (if any) triggers the row break.
      if (src[i + 1] !== '\n') pushRow()
    } else {
      field += ch
    }
  }
  // Final row without trailing newline.
  if (field !== '' || row.length > 0) pushRow()

  return rows
}

/** Thrown when a hard limit is exceeded — the route maps this to HTTP 413. */
export class ParseLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParseLimitError'
  }
}

// ─────────────────────────────── JSON ───────────────────────────────

/** Keys whose array value we accept as the record list (export-tool shapes). */
const ARRAY_KEYS = ['records', 'issues', 'commits', 'tickets', 'lines', 'items', 'data', 'invoices']

/**
 * Parse a JSON upload. Accepts:
 *   [ {...}, {...} ]                          — bare array of records
 *   { "records": [...] }                      — wrapped array (also
 *   { "issues": [...] } etc.                    common export shapes)
 * Non-object array elements are reported as row errors, not fatal.
 */
export function parseJsonRecords(text: string): { rows: Record<string, string>[]; errors: ParseError[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('file is not valid JSON')
  }
  let list: unknown[] | null = null
  if (Array.isArray(parsed)) {
    list = parsed
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    for (const key of ARRAY_KEYS) {
      if (Array.isArray(obj[key])) {
        list = obj[key] as unknown[]
        break
      }
    }
  }
  if (!list) {
    throw new Error('JSON must be an array of records, or an object with one of: ' + ARRAY_KEYS.join(', '))
  }

  const rows: Record<string, string>[] = []
  const errors: ParseError[] = []
  for (let i = 0; i < list.length; i++) {
    const el = list[i]
    if (!el || typeof el !== 'object' || Array.isArray(el)) {
      errors.push({ row: i + 1, message: 'record is not an object' })
      continue
    }
    if (rows.length >= MAX_ROWS) {
      errors.push({ row: i + 1, message: `file exceeds ${MAX_ROWS} rows` })
      break
    }
    const rec: Record<string, string> = {}
    for (const [k, v] of Object.entries(el as Record<string, unknown>)) {
      const norm = normalizeHeader(k)
      if (!norm) continue
      if (v === null || v === undefined) rec[norm] = ''
      else if (typeof v === 'object') continue // nested objects are not flat-row material
      else rec[norm] = String(v)
    }
    rows.push(rec)
  }
  return { rows, errors }
}

// ──────────────────────────── Entry point ────────────────────────────

/**
 * Parse an uploaded file (by name + text content) into normalized rows.
 * Format is detected from the extension, falling back to content sniffing:
 * leading '[' or '{' (after whitespace/BOM) → JSON, else CSV.
 */
export function parseUpload(fileName: string, text: string): ParsedFile {
  const lower = fileName.toLowerCase()
  const sniff = text.replace(/^\uFEFF/, '').trimStart()[0]
  const format: 'csv' | 'json' =
    lower.endsWith('.json') || (!lower.endsWith('.csv') && (sniff === '[' || sniff === '{'))
      ? 'json'
      : 'csv'

  if (format === 'json') {
    const { rows, errors } = parseJsonRecords(text)
    const headers = rows.length > 0 ? Object.keys(rows[0] as Record<string, string>) : []
    return { format, headers, rows, errors }
  }

  const matrix = parseCsvMatrix(text)
  if (matrix.length === 0) {
    return { format, headers: [], rows: [], errors: [{ row: 0, message: 'file contains no rows' }] }
  }
  const headers = (matrix[0] as string[]).map(normalizeHeader)
  const rows: Record<string, string>[] = []
  const errors: ParseError[] = []
  for (let i = 1; i < matrix.length; i++) {
    const cells = matrix[i] as string[]
    const rec: Record<string, string> = {}
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c] as string
      if (!key) continue // column with an empty/unnamed header
      rec[key] = (cells[c] ?? '').trim()
    }
    rows.push(rec)
  }
  return { format, headers, rows, errors }
}
