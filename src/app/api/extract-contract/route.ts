import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { ok, fail, invalidRequest, withErrorHandler } from '@/lib/api'
import { ExtractContractSchema } from '@/lib/schemas'
import { getCurrentActor, getRequestId } from '@/lib/actor'

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

export const POST = withErrorHandler(async (req: NextRequest) => {
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

  // Call the LLM.
  const zai = await ZAI.create()
  const completion = await zai.chat.completions.create({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: rawText },
    ],
    thinking: { type: 'disabled' },
  })
  const content = completion?.choices?.[0]?.message?.content ?? ''

  // Strip code fences.
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()

  let extracted: ExtractedContract
  try {
    extracted = JSON.parse(cleaned)
  } catch {
    // Fallback: regex-extract first {...} blob. (This is salvage, NOT a
    // proper re-prompt — see §9.2 of the plan for the real fix.)
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (!m) {
      return fail('LLM returned non-JSON output', 502)
    }
    extracted = JSON.parse(m[0])
  }

  // Deterministic validation.
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
    const actor = await getCurrentActor()
    const requestId = await getRequestId()

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
            actor,
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
          totalValue: validated.totalValue,
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
            rate: typeof li.rate === 'number' ? li.rate : null,
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
            value: typeof m.value === 'number' ? m.value : null,
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
          actor,
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
