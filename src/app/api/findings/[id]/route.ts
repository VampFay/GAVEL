import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, notFound, invalidRequest, withErrorHandler } from '@/lib/api'
import {
  PatchFindingSchema,
  type FindingActionT,
} from '@/lib/schemas'
import { getRequestId } from '@/lib/actor'
import { requireRole } from '@/lib/auth'
import { money } from '@/lib/money'
import { parseConfidenceBreakdown } from '@/lib/engine/confidence'
import {
  ALLOWED_TRANSITIONS,
  ACTION_TO_STATUS,
} from '@/lib/finding-state-machine'

export const dynamic = 'force-dynamic'

/**
 * Finding status state machine — see src/lib/finding-state-machine.ts
 * (the route handler and the unit test both import from there).
 */

export const GET = withErrorHandler(
  async (
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    const { id } = await params
    const finding = await db.finding.findUnique({
      where: { id },
      include: {
        evidence: { orderBy: { weight: 'desc' } },
        project: true,
        contract: true,
      },
    })
    if (!finding) return notFound('finding not found')
    // Decimal → number at the response boundary (see src/lib/money.ts).
    // confidenceBreakdown: JSON string → parsed object (null for legacy /
    // manually-created findings; the UI synthesizes a fallback).
    return ok({
      finding: {
        ...finding,
        impactAmount: money(finding.impactAmount),
        confidenceBreakdown: parseConfidenceBreakdown(finding.confidenceBreakdown),
      },
    })
  }
)

export const PATCH = withErrorHandler(
  async (
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    const { id } = await params

    // ── Authorization: reviewer+ to approve/dismiss/escalate ──────────
    // Throwing AuthError here maps to 401 (unauthenticated) or 403
    // (insufficient role) via withErrorHandler.
    const actor = await requireRole(['reviewer', 'admin'])
    const actorId = actor.id
    const requestId = await getRequestId()

    // Parse + validate the body with Zod.
    const text = await req.text()
    let body: unknown
    try {
      body = text ? JSON.parse(text) : {}
    } catch {
      return invalidRequest('invalid json')
    }
    const parsed = PatchFindingSchema.safeParse(body)
    if (!parsed.success) return invalidRequest(parsed.error)
    const { action, reviewNotes } = parsed.data

    // Existence check + state-machine validation in one query.
    const existing = await db.finding.findUnique({
      where: { id },
      select: { id: true, status: true },
    })
    if (!existing) return notFound('finding not found')

    const allowed = ALLOWED_TRANSITIONS[existing.status]
    if (!allowed || !allowed.has(action)) {
      return fail(
        `finding in status '${existing.status}' cannot be ${action}ed`,
        409 // 409 Conflict — semantically correct for illegal state transition
      )
    }

    const newStatus = ACTION_TO_STATUS[action]

    // Wrap the write + audit-log entry in a single transaction. If the
    // audit-log insert fails (rare but possible), the finding update is
    // rolled back — protects the audit trail's integrity.
    const updated = await db.$transaction(async tx => {
      const f = await tx.finding.update({
        where: { id },
        data: {
          status: newStatus,
          reviewedAt: new Date(),
          reviewedById: actorId, // verified FK to User (was a free-text string)
          reviewNotes: reviewNotes ?? null,
        },
      })
      await tx.auditLog.create({
        data: {
          actorId,
          actor: actor.email,
          action,
          entityType: 'finding',
          entityId: id,
          detail: reviewNotes ?? `Finding ${action}ed`,
          requestId: requestId ?? undefined,
        },
      })
      return f
    })

    return ok({ finding: { ...updated, impactAmount: money(updated.impactAmount) } })
  }
)
