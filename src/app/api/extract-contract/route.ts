import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { ok, fail, invalidRequest, withErrorHandler } from '@/lib/api'
import { ExtractContractSchema } from '@/lib/schemas'
import { getRequestId } from '@/lib/actor'
import { requireRole } from '@/lib/auth'
import { toDecimal } from '@/lib/money'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ExtractedLineItem {
  description: string
  rate: number | null
  rateUnit: string | null
  quantity: number | null
  milestone: string | null
}

interface ExtractedMilestone {
  id: string
  description: string
  dueDate: string
  value: number | null
  currency: string
}

interface ExtractedExclusion {
  clause: string
  description: string
}

interface ExtractedContract {
  title: string | null
  effectiveDate: string | null
  endDate: string | null
  currency: string | null
  totalValue: number | null
  lineItems: ExtractedLineItem[]
  milestones: ExtractedMilestone[]
  exclusions: ExtractedExclusion[]
  changeOrderPolicy: string | null
  rawNotes: string[]
}

const SYSTEM_PROMPT = `You are ShipLedger's contract extraction engine. Given a Statement of Work (SOW) or master services contract, extract structured data into a strict JSON schema.

Extract:
- title: the contract/project title
- effectiveDate, endDate: ISO 8601 (YYYY-MM-DD) where parseable
- currency: ISO 4217 code (default INR)
- totalValue: numeric contract value where stated
- lineItems: each scope or rate-card entry with description, rate (numeric), rateUnit (hour|day|story-point|fixed|month|unit), quantity (numeric), milestone id (e.g. "M1") if applicable
- milestones: each milestone with id (e.g. "M1"), description, dueDate (ISO), value (numeric), currency
- exclusions: each exclusion clause with clause ref (e.g. "5.1") and description
- changeOrderPolicy: short summary of how change orders are authorized under this contract (or null if unstated)

Return ONLY valid JSON matching this exact shape:
{
  "title": string | null,
  "effectiveDate": string | null,
  "endDate": string | null,
  "currency": string | null,
  "totalValue": number | null,
  "lineItems": [{ "description": string, "rate": number | null, "rateUnit": string | null, "quantity": number | null, "milestone": string | null }],
  "milestones": [{ "id": string, "description": string, "dueDate": string, "value": number | null, "currency": string }],
  "exclusions": [{ "clause": string, "description": string }],
  "changeOrderPolicy": string | null,
  "rawNotes": [string]
}

Rules:
- If a field cannot be parsed, use null (do not invent values).
- All monetary values must be plain numbers (no symbols, no commas, no thousand separators).
- Do NOT wrap the JSON in markdown fences. Output raw JSON only.
- Do NOT include any commentary, headings, or text outside the JSON object.`

const RE_PROMPT_SUFFIX = `\n\nIMPORTANT — your previous output did not parse as valid JSON or did not match the schema. Please re-emit the entire JSON object, valid this time, with no prose or markdown fences.`

const MAX_EXTRACTION_ATTEMPTS = 3

/** Backoff helper: wait `n * 250ms + small jitter` between LLM retries. */
function backoffMs(attempt: number): number {
  const base = Math.min(attempt, 5) * 250
  const jitter = Math.floor(Math.random() * 100)
  return base + jitter
}

/** Sleep helper for `await sleep(ms)`. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  // ── Authorization: admin only — contract ingestion writes structural
  // data the rest of the audit will rely on. Tighter than findings PATCH
  // (reviewer+) because bad contract data poisons every downstream
  // finding for that client.
  const actor = await requireRole(['admin'])
  const requestId = await getRequestId()

  // Parse + validate body with Zod.
  const text = await req.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    return invalidRequest('invalid json')
  }
  const validatedBody = ExtractContractSchema.safeParse(body)
  if (!validatedBody.success) return invalidRequest(validatedBody.error)
  const { rawText, persist, clientId } = validatedBody.data

  const zai = await ZAI.create()

  // ── LLM extraction with real re-prompt-on-validation-failure (§9.2) ──
  // Previous implementation: parse failure → regex-grab first {...} blob.
  // That silently produced partially-wrong contract records. Now: parse
  // failure → re-prompt the model with an explicit "your previous output
  // didn't validate" instruction. Up to MAX_EXTRACTION_ATTEMPTS total
  // calls. Only after exhausting the retry budget do we fail.
  let extracted: ExtractedContract | null = null
  let attempt = 0
  let lastParseError: string | null = null
  while (attempt < MAX_EXTRACTION_ATTEMPTS) {
    attempt++
    const userContent =
      attempt === 1
        ? rawText
        : `${rawText}${RE_PROMPT_SUFFIX}${lastParseError ? `\n\nLast error: ${lastParseError}` : ''}`

    let content = ''
    try {
      const completion = await zai.chat.completions.create({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        thinking: { type: 'disabled' },
      })
      content = completion?.choices?.[0]?.message?.content ?? ''
    } catch (err) {
      // Transient LLM failure — backoff and retry. If the last attempt
      // also fails, we surface to the caller with a 502.
      if (attempt >= MAX_EXTRACTION_ATTEMPTS) {
        return fail('LLM extraction failed (transient errors)', 502)
      }
      await sleep(backoffMs(attempt))
      continue
    }

    // Strip code fences if present.
    const cleaned = content
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()

    try {
      extracted = JSON.parse(cleaned) as ExtractedContract
      lastParseError = null
      break
    } catch (err) {
      lastParseError = err instanceof Error ? err.message : 'invalid JSON'
      if (attempt >= MAX_EXTRACTION_ATTEMPTS) {
        // Re-prompt budget exhausted — give up honestly. Do NOT fall back
        // to the regex salvage of the first {...} blob (which would
        // silently produce a partially-wrong contract record).
        return fail('LLM returned non-JSON output after retry budget', 502)
      }
      // Loop continues — re-prompt will include the error message.
    }
  }

  if (!extracted) {
    // Unreachable — the loop above either breaks with extracted set or
    // returns. Defensive only.
    return fail('LLM extraction failed', 502)
  }

  // ── Deterministic validation (unchanged) ───────────────────────────
  const validated: ExtractedContract = {
    title: typeof extracted.title === 'string' ? extracted.title : null,
    effectiveDate: safeDate(extracted.effectiveDate),
    endDate: safeDate(extracted.endDate),
    currency: typeof extracted.currency === 'string' && extracted.currency.length === 3 ? extracted.currency.toUpperCase() : 'INR',
    totalValue: typeof extracted.totalValue === 'number' && isFinite(extracted.totalValue) ? extracted.totalValue : null,
    lineItems: Array.isArray(extracted.lineItems)
      ? extracted.lineItems.filter(li => li && typeof li.description === 'string')
      : [],
    milestones: Array.isArray(extracted.milestones)
      ? extracted.milestones.filter(m => m && typeof m.id === 'string')
      : [],
    exclusions: Array.isArray(extracted.exclusions)
      ? extracted.exclusions.filter(e => e && typeof e.description === 'string')
      : [],
    changeOrderPolicy: typeof extracted.changeOrderPolicy === 'string' ? extracted.changeOrderPolicy : null,
    rawNotes: Array.isArray(extracted.rawNotes) ? extracted.rawNotes.filter((n: unknown) => typeof n === 'string') : [],
  }

  // Idempotency: hash of rawText. If a contract with the same hash already
  // exists for the same client, return it instead of creating a duplicate.
  const contentHash = createHash('sha256').update(rawText).digest('hex')
  let contractId: string | null = null

  if (persist && clientId) {
    // Wrap the entire write in a transaction: contract create + line items
    // + milestones + exclusions + audit-log. All-or-nothing.
    const c = await db.$transaction(async tx => {
      // Idempotency check — query inside the transaction.
      const existing = await tx.contract.findFirst({
        where: { clientId, rawText },
        select: { id: true },
      })
      if (existing) {
        // Idempotent — don't duplicate. Still log the retry.
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            actor: actor.email,
            action: 'extract',
            entityType: 'contract',
            entityId: existing.id,
            detail: `Idempotent re-extraction (content hash match) — returning existing contract`,
            requestId: requestId ?? undefined,
          },
        })
        return { id: existing.id, reused: true as const }
      }

      const newContract = await tx.contract.create({
        data: {
          clientId,
          title: validated.title ?? 'Uploaded SOW',
          effectiveDate: validated.effectiveDate ? new Date(validated.effectiveDate) : new Date(),
          endDate: validated.endDate ? new Date(validated.endDate) : null,
          currency: validated.currency ?? 'INR',
          totalValue: toDecimal(validated.totalValue),
          rawText,
          extractedJson: JSON.stringify(validated),
          status: 'active',
        },
      })

      // Persist line items (was already done).
      if (validated.lineItems.length) {
        await tx.lineItem.createMany({
          data: validated.lineItems.map(li => ({
            contractId: newContract.id,
            description: li.description,
            rate: toDecimal(li.rate),
            rateUnit: li.rateUnit ?? null,
            quantity: typeof li.quantity === 'number' ? li.quantity : null,
            milestone: li.milestone ?? null,
            deliveryDate: li.milestone
              ? matchedMilestoneDate(li.milestone, validated.milestones)
              : null,
          })),
        })
      }

      // Persist milestones — the previous implementation silently discarded these.
      if (validated.milestones.length) {
        await tx.milestone.createMany({
          data: validated.milestones.map(m => ({
            contractId: newContract.id,
            externalId: m.id,
            description: m.description,
            dueDate: safeDate(m.dueDate) ? new Date(safeDate(m.dueDate)!) : null,
            value: toDecimal(m.value),
            currency: typeof m.currency === 'string' && m.currency.length === 3 ? m.currency.toUpperCase() : 'INR',
          })),
        })
      }

      // Persist exclusions — also previously discarded.
      if (validated.exclusions.length) {
        await tx.exclusion.createMany({
          data: validated.exclusions.map(e => ({
            contractId: newContract.id,
            clause: typeof e.clause === 'string' ? e.clause : null,
            description: e.description,
          })),
        })
      }

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          actor: actor.email,
          action: 'extract',
          entityType: 'contract',
          entityId: newContract.id,
          detail: `LLM extraction — ${validated.lineItems.length} line items, ${validated.milestones.length} milestones, ${validated.exclusions.length} exclusions`,
          requestId: requestId ?? undefined,
        },
      })

      return { id: newContract.id, reused: false as const }
    })

    contractId = c.id
  }

  return ok({
    contractId,
    reused: contractId !== null ? null : null, // explicitly null when not persisted
    extracted: validated,
    // Intentionally NOT echoing raw LLM content — info disclosure.
  })
})

function safeDate(s: unknown): string | null {
  if (typeof s !== 'string' || !s) return null
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function matchedMilestoneDate(
  milestoneId: string,
  milestones: ExtractedMilestone[]
): Date | null {
  const m = milestones.find(x => x.id.toLowerCase() === milestoneId.toLowerCase())
  if (!m || !m.dueDate) return null
  const d = new Date(m.dueDate)
  return isNaN(d.getTime()) ? null : d
}
