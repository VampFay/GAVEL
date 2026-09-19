import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ok, fail, invalidRequest, withErrorHandler } from '@/lib/api'
import { getRequestId } from '@/lib/actor'
import { requireRole } from '@/lib/auth'
import { toDecimal, sumMoney } from '@/lib/money'
import { checkRateLimit, recordRateLimitHit } from '@/lib/rate-limit-store'
import { parseUpload, ParseLimitError, MAX_ROWS } from '@/lib/ingest/parse'
import { commitTickets, commitCodeActivities } from '@/lib/ingest/commit'
import {
  SOURCE_TYPES,
  mapTickets,
  mapCodeActivities,
  mapInvoiceLines,
  groupInvoices,
  expectedColumns,
  type SourceType,
} from '@/lib/ingest/mappers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Exactly one of these is set (per sourceType) — typed so the commit
// branches below get narrowed record types without casts.
type TicketResult = ReturnType<typeof mapTickets>
type ActivityResult = ReturnType<typeof mapCodeActivities>
type InvoiceResult = ReturnType<typeof mapInvoiceLines>

/**
 * POST /api/ingest — upload delivery/billing evidence as CSV or JSON.
 *
 * This is the minimum viable ingestion path (audit v3's top priority): a
 * real customer's Jira/GitHub/accounting EXPORT goes in, engine-consumable
 * Ticket / CodeActivity / Invoice rows come out. Live OAuth connectors
 * (GitHub, Jira, QuickBooks) remain roadmap — they land as new source types
 * behind this same route, not a parallel path.
 *
 * Auth: admin only — same privilege as reconcile and extract-contract.
 * Ingestion feeds the engine; poisoned delivery data poisons every
 * downstream finding for that client (the same reasoning extract-contract
 * uses for its admin gate).
 *
 * Rate limit: 20 uploads / 5 min per user, counted on EVERY attempt (not
 * failures-only like login) — each upload costs parse+validate+write work
 * regardless of outcome. In-memory, single-process (same honest scope as
 * the login limiter — swap for Redis before horizontal scaling).
 *
 * Request (multipart/form-data):
 *   file       — .csv or .json (≤ 2 MB, ≤ 2,500 rows)
 *   sourceType — 'jira-tickets' | 'github-commits' | 'invoice-lines'
 *   clientId   — the client whose audit this evidence belongs to
 *   dryRun     — 'true' to validate + preview without writing
 *
 * Idempotence (re-uploading the same file is a no-op):
 *   - jira-tickets: upsert keyed on (projectId, externalId) — re-upload
 *     UPDATES ticket fields instead of duplicating.
 *   - github-commits: deduped by ref within the project.
 *   - invoice-lines: invoice numbers already on file for this client are
 *     skipped entirely (lines are not re-added).
 *
 * Every commit writes one immutable AuditLog row (action: 'ingest').
 */

const MAX_FILE_BYTES = 2 * 1024 * 1024
const INGEST_MAX = 20
const INGEST_WINDOW_MS = 5 * 60_000
const PREVIEW_ROWS = 10
const MAX_REPORTED_ERRORS = 25

export const POST = withErrorHandler(
  async (req: NextRequest) => {
    // ── Authorization: admin only ─────────────────────────────────
    const actor = await requireRole(['admin'])
    const requestId = await getRequestId()

    // ── Rate limit (every attempt counts — see route docblock) ────
    const limitKey = `ingest:user:${actor.id}`
    const limit = await checkRateLimit(limitKey, INGEST_MAX, INGEST_WINDOW_MS)
    if (!limit.allowed) {
      return NextResponse.json(
        { ok: false, error: 'too many uploads — try again later' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
      )
    }
    await recordRateLimitHit(limitKey, INGEST_WINDOW_MS)

    // ── Multipart parse ───────────────────────────────────────────
    const contentType = req.headers.get('content-type') ?? ''
    if (!contentType.includes('multipart/form-data')) {
      return invalidRequest('expected multipart/form-data with a file field')
    }
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return invalidRequest('could not read multipart body')
    }

    const file = form.get('file')
    if (!(file instanceof File)) return invalidRequest('file field is required')
    const sourceTypeRaw = String(form.get('sourceType') ?? '')
    if (!SOURCE_TYPES.includes(sourceTypeRaw as SourceType)) {
      return invalidRequest(`sourceType must be one of: ${SOURCE_TYPES.join(', ')}`)
    }
    const sourceType = sourceTypeRaw as SourceType
    const clientId = String(form.get('clientId') ?? '')
    if (!clientId) return invalidRequest('clientId is required')
    const dryRun = ['true', '1'].includes(String(form.get('dryRun') ?? '').toLowerCase())

    const lowerName = file.name.toLowerCase()
    if (!lowerName.endsWith('.csv') && !lowerName.endsWith('.json')) {
      return invalidRequest('file must be .csv or .json')
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { ok: false, error: `file exceeds ${MAX_FILE_BYTES / 1024 / 1024} MB limit` },
        { status: 413 }
      )
    }

    // ── Parse ─────────────────────────────────────────────────────
    const text = await file.text()
    let parsed
    try {
      parsed = parseUpload(file.name, text)
    } catch (err) {
      if (err instanceof ParseLimitError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: 413 })
      }
      return invalidRequest(err instanceof Error ? err.message : 'could not parse file')
    }
    if (parsed.rows.length === 0 && parsed.errors.length > 0) {
      return invalidRequest(`no parseable rows — ${parsed.errors[0]?.message ?? 'unknown error'}`)
    }
    if (parsed.rows.length > MAX_ROWS) {
      return NextResponse.json(
        { ok: false, error: `file exceeds ${MAX_ROWS} rows` },
        { status: 413 }
      )
    }

    // ── Map + validate ────────────────────────────────────────────
    // Exactly one of these is set (per sourceType) — typed so the commit
    // branches below get narrowed record types without casts.
    const ticketResult = sourceType === 'jira-tickets' ? mapTickets(parsed) : null
    const activityResult = sourceType === 'github-commits' ? mapCodeActivities(parsed) : null
    const invoiceResult = sourceType === 'invoice-lines' ? mapInvoiceLines(parsed) : null
    const mapped = ticketResult ?? activityResult ?? invoiceResult
    if (!mapped) return invalidRequest('unreachable: bad sourceType')

    const response: Record<string, unknown> = {
      sourceType,
      dryRun,
      file: { name: file.name, size: file.size, format: parsed.format },
      parsed: mapped.totalRows,
      valid: mapped.valid.length,
      invalid: mapped.invalid.length,
      errors: mapped.invalid.slice(0, MAX_REPORTED_ERRORS),
      expectedColumns: expectedColumns(sourceType),
    }

    if (mapped.valid.length === 0) {
      // Nothing usable — 422 so tooling can distinguish "file read but all
      // rows rejected" from a transport/format 400.
      return NextResponse.json(
        { ok: false, error: 'no valid rows', ...response },
        { status: 422 }
      )
    }

    if (dryRun) {
      return ok({
        ...response,
        preview: mapped.valid.slice(0, PREVIEW_ROWS).map(r =>
          Object.fromEntries(
            Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 10) : v])
          )
        ),
      })
    }

    // ── Resolve client → contract → project ──────────────────────
    // Same resolution order as the reconcile route (contracts[0],
    // projects[0]) so ingested evidence lands exactly where the engine
    // reads it. The project is get-or-created as a safety net for
    // contracts that predate the extract-route fix.
    const client = await db.client.findUnique({
      where: { id: clientId },
      include: { contracts: { include: { projects: true } } },
    })
    if (!client) return fail('client not found', 404)
    if (client.deletedAt) return fail('client is soft-deleted', 409)
    const contract = client.contracts[0]
    if (!contract) return fail('client has no contract — intake the SOW first', 409)

    // ── Commit (single transaction) ───────────────────────────────
    // tickets + code activities go through the SHARED commit layer
    // (src/lib/ingest/commit.ts) — the same code path the live
    // connectors use, so idempotence semantics can never drift.
    const tenantId = client.tenantId
    let created = 0
    let updated = 0
    let duplicates = 0
    let invoicesCreated = 0
    let linesCreated = 0
    let linesSkippedExistingInvoice = 0
    let projectId: string | null = null

    await db.$transaction(async tx => {
      const project =
        contract.projects[0] ??
        (await tx.project.create({
          data: {
            tenantId,
            clientId: client.id,
            contractId: contract.id,
            name: contract.title,
            status: 'active',
            startDate: contract.effectiveDate,
          },
        }))
      projectId = project.id

      if (ticketResult) {
        const r = await commitTickets(tx, project.id, tenantId, ticketResult.valid)
        created = r.created
        updated = r.updated
      }

      if (activityResult) {
        const r = await commitCodeActivities(tx, project.id, tenantId, activityResult.valid)
        created = r.created
        duplicates = r.duplicates
      }

      if (invoiceResult) {
        const existing = await tx.invoice.findMany({
          where: { clientId: client.id },
          select: { number: true },
        })
        const knownInvoices = new Set(existing.map(i => i.number.trim().toUpperCase()))
        const groups = groupInvoices(invoiceResult.valid)
        for (const [number, lines] of groups) {
          if (knownInvoices.has(number)) {
            linesSkippedExistingInvoice += lines.length
            duplicates++
            continue
          }
          const first = lines[0]
          if (!first) continue
          if (!first.issueDate) {
            throw new Error(`invoice ${number}: no issue date on any row (add an "issue date" column)`)
          }
          const invoice = await tx.invoice.create({
            data: {
              tenantId,
              clientId: client.id,
              contractId: contract.id,
              number,
              issueDate: first.issueDate,
              dueDate: first.dueDate,
              status: first.status,
              // sumMoney never returns null (0 fallback) — Invoice.total is non-nullable.
              total: new Prisma.Decimal(sumMoney(lines.map(l => l.amount))),
              currency: first.currency,
            },
          })
          await tx.invoiceLine.createMany({
            data: lines.map(l => ({
              tenantId,
              invoiceId: invoice.id,
              description: l.description,
              amount: toDecimal(l.amount) ?? new Prisma.Decimal(0),
              periodStart: l.periodStart,
              periodEnd: l.periodEnd,
            })),
          })
          knownInvoices.add(number)
          invoicesCreated++
          linesCreated += lines.length
        }
        created = linesCreated
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actor: actor.email,
          action: 'ingest',
          entityType: 'client',
          entityId: client.id,
          detail:
            `Ingested ${file.name} (${sourceType}) — rows ${mapped.totalRows}, ` +
            `valid ${mapped.valid.length}, invalid ${mapped.invalid.length}, ` +
            `created ${created}, updated ${updated}, duplicates ${duplicates}` +
            (requestId ? ` (request ${requestId})` : ''),
          requestId: requestId ?? undefined,
        },
      })
    })

    return ok({
      ...response,
      committed: {
        projectId,
        created,
        updated,
        duplicates,
        invoicesCreated,
        linesCreated,
        linesSkippedExistingInvoice,
        hint: 'Run the reconciliation engine (POST /api/audits/{clientId}/reconcile) to evaluate the new evidence.',
      },
    })
  }
)
