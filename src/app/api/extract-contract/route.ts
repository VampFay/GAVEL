import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const rawText: string = body?.rawText ?? ''
    const persist: boolean = body?.persist ?? true
    const clientId: string | undefined = body?.clientId

    if (!rawText || rawText.trim().length < 30) {
      return NextResponse.json(
        { ok: false, error: 'rawText is required (min 30 chars)' },
        { status: 400 }
      )
    }

    // Call the LLM
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: rawText },
      ],
      thinking: { type: 'disabled' },
    })
    const content = completion?.choices?.[0]?.message?.content ?? ''

    // Parse — strip code fences if present
    const cleaned = content
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()

    let parsed: ExtractedContract
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      // Fallback: try to extract first {... ...} blob
      const m = cleaned.match(/\{[\s\S]*\}/)
      if (!m) {
        return NextResponse.json(
          { ok: false, error: 'LLM returned non-JSON output', raw: content },
          { status: 502 }
        )
      }
      parsed = JSON.parse(m[0])
    }

    // Deterministic validation (mirrors §9.2 of the plan):
    // - dates parse, amounts parse, required fields present
    const validated: ExtractedContract = {
      title: typeof parsed.title === 'string' ? parsed.title : null,
      effectiveDate: safeDate(parsed.effectiveDate),
      endDate: safeDate(parsed.endDate),
      currency: typeof parsed.currency === 'string' && parsed.currency.length === 3 ? parsed.currency.toUpperCase() : 'INR',
      totalValue: typeof parsed.totalValue === 'number' && isFinite(parsed.totalValue) ? parsed.totalValue : null,
      lineItems: Array.isArray(parsed.lineItems)
        ? parsed.lineItems.filter(li => li && typeof li.description === 'string')
        : [],
      milestones: Array.isArray(parsed.milestones)
        ? parsed.milestones.filter(m => m && typeof m.id === 'string')
        : [],
      exclusions: Array.isArray(parsed.exclusions)
        ? parsed.exclusions.filter(e => e && typeof e.description === 'string')
        : [],
      changeOrderPolicy: typeof parsed.changeOrderPolicy === 'string' ? parsed.changeOrderPolicy : null,
      rawNotes: Array.isArray(parsed.rawNotes) ? parsed.rawNotes.filter((n: unknown) => typeof n === 'string') : [],
    }

    // Persist to contract record if requested
    let contractId: string | null = null
    if (persist && clientId) {
      const c = await db.contract.create({
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
      contractId = c.id

      // Persist line items
      if (validated.lineItems.length) {
        await db.lineItem.createMany({
          data: validated.lineItems.map(li => ({
            contractId: c.id,
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

      await db.auditLog.create({
        data: {
          actor: 'intake@shipledger',
          action: 'extract',
          entityType: 'contract',
          entityId: c.id,
          detail: `LLM extraction — ${validated.lineItems.length} line items, ${validated.milestones.length} milestones, ${validated.exclusions.length} exclusions`,
        },
      })
    }

    return NextResponse.json({
      ok: true,
      contractId,
      extracted: validated,
      raw: content,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown extraction error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

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
