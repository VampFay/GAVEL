import { describe, it, expect } from 'vitest'
import {
  parseUpload,
  parseCsvMatrix,
  parseJsonRecords,
  normalizeHeader,
  ParseLimitError,
  MAX_ROWS,
} from '../../src/lib/ingest/parse'
import {
  mapTickets,
  mapCodeActivities,
  mapInvoiceLines,
  groupInvoices,
  expectedColumns,
  coerceNumber,
  coerceDate,
} from '../../src/lib/ingest/mappers'

/**
 * Ingestion unit tests — the parser and mappers are pure functions; the
 * route is thin glue over them and is exercised end-to-end by
 * scripts/ingest-demo.sh against the live app.
 */

const csv = (header: string, ...rows: string[]) => [header, ...rows].join('\n') + '\n'

// ─────────────────────────── CSV parser ───────────────────────────

describe('parseCsvMatrix', () => {
  it('parses a plain header + rows', () => {
    const m = parseCsvMatrix('a,b,c\n1,2,3\n4,5,6')
    expect(m).toEqual([['a', 'b', 'c'], ['1', '2', '3'], ['4', '5', '6']])
  })
  it('handles CRLF line endings and a trailing newline', () => {
    const m = parseCsvMatrix('a,b\r\n1,2\r\n')
    expect(m).toEqual([['a', 'b'], ['1', '2']])
  })
  it('handles quoted fields with embedded commas, quotes and newlines', () => {
    const m = parseCsvMatrix('key,summary\nENG-1,"Fix, the ""login"" flow"\nENG-2,"line1\nline2"')
    expect(m[1]).toEqual(['ENG-1', 'Fix, the "login" flow'])
    expect(m[2]).toEqual(['ENG-2', 'line1\nline2'])
  })
  it('strips a UTF-8 BOM', () => {
    const m = parseCsvMatrix('\uFEFFa,b\n1,2')
    expect(m[0]).toEqual(['a', 'b'])
  })
  it('skips fully-empty lines', () => {
    const m = parseCsvMatrix('a,b\n\n1,2\n\n')
    expect(m.length).toBe(2)
  })
  it('enforces the row cap', () => {
    const big = Array.from({ length: MAX_ROWS + 5 }, (_, i) => `r${i},x`).join('\n')
    expect(() => parseCsvMatrix(`a,b\n${big}`)).toThrow(ParseLimitError)
  })
})

describe('parseUpload', () => {
  it('maps CSV cells to normalized-key row objects', () => {
    const p = parseUpload('tickets.csv', csv('Issue Key,Summary,Status', 'ENG-1,Fix login,done', 'ENG-2,Fix logout,done'))
    expect(p.format).toBe('csv')
    expect(p.headers).toEqual(['issuekey', 'summary', 'status'])
    expect(p.rows[0]).toEqual({ issuekey: 'ENG-1', summary: 'Fix login', status: 'done' })
    expect(p.errors.length).toBe(0)
  })
  it('parses a bare JSON array with normalization', () => {
    const p = parseUpload('tickets.json', JSON.stringify([
      { 'Issue Key': 'ENG-1', Summary: 'Fix login', 'Story Points': 5 },
    ]))
    expect(p.format).toBe('json')
    expect(p.rows[0]).toEqual({ issuekey: 'ENG-1', summary: 'Fix login', storypoints: '5' })
  })
  it('parses wrapped export shapes ({ issues: [...] } etc.)', () => {
    const p = parseUpload('jira.json', JSON.stringify({ issues: [{ key: 'ENG-9', summary: 'x' }] }))
    expect(p.rows.length).toBe(1)
    expect(p.rows[0]?.key).toBe('ENG-9')
  })
  it('rejects JSON that is neither array nor wrapped array', () => {
    expect(() => parseUpload('x.json', '{"foo": "bar"}')).toThrow(/array/)
    expect(() => parseUpload('x.json', 'not json')).toThrow(/valid JSON/)
  })
  it('reports non-object array elements as row errors without failing the file', () => {
    const { rows, errors } = parseJsonRecords('[{"a":1}, "oops", {"b":2}]')
    expect(rows.length).toBe(2)
    expect(errors.length).toBe(1)
    expect(errors[0]?.row).toBe(2)
  })
  it('sniffs format from content when extension is ambiguous', () => {
    expect(parseUpload('export.txt', '[{"a":1}]').format).toBe('json')
    expect(parseUpload('export.txt', 'a,b\n1,2').format).toBe('csv')
  })
})

// ─────────────────────────── Coercion ───────────────────────────

describe('coerceNumber', () => {
  it('strips currency symbols, commas and whitespace', () => {
    expect(coerceNumber('₹ 1,84,000')).toBe(184000)
    expect(coerceNumber('$2,200.50')).toBe(2200.5)
    expect(coerceNumber('84000')).toBe(84000)
  })
  it('treats parenthesized values as negative (accounting style)', () => {
    expect(coerceNumber('(500)')).toBe(-500)
  })
  it('returns null for garbage', () => {
    expect(coerceNumber('')).toBeNull()
    expect(coerceNumber('abc')).toBeNull()
    expect(coerceNumber('-')).toBeNull()
  })
})

describe('coerceDate', () => {
  it('parses ISO dates and timestamps', () => {
    expect(coerceDate('2025-07-15')?.toISOString().slice(0, 10)).toBe('2025-07-15')
    expect(coerceDate('2025-07-15T10:30:00Z')?.toISOString().slice(0, 10)).toBe('2025-07-15')
  })
  it('parses dd/mm/yyyy day-first (Indian convention)', () => {
    expect(coerceDate('15/07/2025')?.toISOString().slice(0, 10)).toBe('2025-07-15')
    expect(coerceDate('1-8-2025')?.toISOString().slice(0, 10)).toBe('2025-08-01')
  })
  it('rejects impossible calendar dates (no silent rollover)', () => {
    expect(coerceDate('31/02/2025')).toBeNull()
    expect(coerceDate('00/13/2025')).toBeNull()
  })
  it('returns null for garbage', () => {
    expect(coerceDate('')).toBeNull()
    expect(coerceDate('yesterday')).toBeNull()
    expect(coerceDate('15/07/25')).toBeNull() // 2-digit year not accepted
  })
})

// ─────────────────────────── Mappers ───────────────────────────

describe('mapTickets', () => {
  it('maps aliases (Jira-style headers) to the Ticket shape', () => {
    const p = parseUpload('t.csv', csv(
      'Issue Key,Summary,Issue Type,Status,Assignee,Created,Resolved',
      'ENG-301,UAT fixes,Task,Done,Meera S.,2025-07-01,2025-07-15'
    ))
    const { valid, invalid } = mapTickets(p)
    expect(invalid.length).toBe(0)
    expect(valid[0]).toMatchObject({
      externalId: 'ENG-301',
      title: 'UAT fixes',
      type: 'task',
      status: 'done',
      assignee: 'Meera S.',
      externalCreated: coerceDate('2025-07-01'),
      externalUpdated: coerceDate('2025-07-15'),
    })
  })
  it('defaults status to todo and lowercases/snake-cases arbitrary statuses', () => {
    const p = parseUpload('t.csv', csv('Key,Summary', 'ENG-1,x'))
    const { valid } = mapTickets(p)
    expect(valid[0]?.status).toBe('todo')
    const p2 = parseUpload('t.csv', csv('Key,Summary,Status', 'ENG-2,y,In Progress'))
    expect(mapTickets(p2).valid[0]?.status).toBe('in_progress')
  })
  it('flags every row when a required column is absent entirely', () => {
    const p = parseUpload('t.csv', csv('Summary,Status', 'x,done')) // no Key column
    const { valid, invalid } = mapTickets(p)
    expect(valid.length).toBe(0)
    expect(invalid.length).toBe(1)
    expect(invalid[0]?.message).toMatch(/required column missing/)
  })
  it('rejects rows with unparseable dates but keeps good rows', () => {
    const p = parseUpload('t.csv', csv('Key,Summary,Resolved', 'ENG-1,good,2025-07-15', 'ENG-2,bad,soonish'))
    const { valid, invalid } = mapTickets(p)
    expect(valid.length).toBe(1)
    expect(invalid.length).toBe(1)
    expect(invalid[0]).toMatchObject({ row: 2, field: 'externalUpdated' })
  })
})

describe('mapCodeActivities', () => {
  it('maps GitHub-style headers with type defaulting to commit', () => {
    const p = parseUpload('c.csv', csv(
      'sha,message,author,date,additions,deletions,files,url',
      'a1f2c3d,Merge UAT fixes,meera-s,2025-07-20T16:40:00Z,1820,90,21,https://github.com/x/pull/361'
    ))
    const { valid, invalid } = mapCodeActivities(p)
    expect(invalid.length).toBe(0)
    expect(valid[0]).toMatchObject({
      type: 'commit',
      ref: 'a1f2c3d',
      title: 'Merge UAT fixes',
      author: 'meera-s',
      additions: 1820,
      deletions: 90,
      filesChanged: 21,
    })
  })
  it('accepts PR-shaped rows via the pr/type column', () => {
    const p = parseUpload('c.csv', csv('ref,message,author,date,type', '#361,Merge PR,meera-s,2025-07-20,pr'))
    const { valid } = mapCodeActivities(p)
    expect(valid[0]?.type).toBe('pr')
    expect(valid[0]?.ref).toBe('#361')
  })
})

describe('mapInvoiceLines + groupInvoices', () => {
  it('maps accounting headers and coerces currency amounts', () => {
    const p = parseUpload('i.csv', csv(
      'Invoice Number,Issue Date,Description,Amount,Period Start,Period End,Status',
      'INV-2025-055,2025-08-04,WCAG remediation,"₹ 84,000",2025-07-01,2025-07-31,Issued'
    ))
    const { valid, invalid } = mapInvoiceLines(p)
    expect(invalid.length).toBe(0)
    expect(valid[0]).toMatchObject({
      invoice: 'INV-2025-055',
      issueDate: coerceDate('2025-08-04'),
      description: 'WCAG remediation',
      amount: 84000,
      status: 'issued',
    })
  })
  it('carries issueDate/status/currency forward within the same invoice', () => {
    const p = parseUpload('i.csv', csv(
      'Invoice Number,Issue Date,Description,Amount',
      'INV-1,2025-08-04,first,100',
      'INV-1,,second,200',
      'INV-2,,third,300'
    ))
    const { valid } = mapInvoiceLines(p)
    expect(valid[1]?.issueDate?.toISOString().slice(0, 10)).toBe('2025-08-04')
    expect(valid[2]?.issueDate).toBeNull() // carry does NOT cross invoices
    expect(valid[2]?.status).toBe('issued')
  })
  it('groups lines by invoice number, preserving order', () => {
    const p = parseUpload('i.csv', csv(
      'Invoice,Issue Date,Description,Amount',
      'INV-B,2025-08-01,b1,10',
      'INV-A,2025-08-01,a1,10',
      'INV-B,2025-08-01,b2,20'
    ))
    const groups = groupInvoices(mapInvoiceLines(p).valid)
    expect([...groups.keys()]).toEqual(['INV-B', 'INV-A'])
    expect(groups.get('INV-B')?.length).toBe(2)
  })
  it('exposes the format contract for humans', () => {
    expect(expectedColumns('jira-tickets')).toContain('key')
    expect(expectedColumns('invoice-lines')[0]).toMatch(/invoice/)
  })
})
