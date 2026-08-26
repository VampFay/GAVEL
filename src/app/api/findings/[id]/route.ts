import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, notFound, invalidRequest, withErrorHandler } from '@/lib/api'
import {
  PatchFindingSchema,
  type FindingActionT,
} from '@/lib/schemas'
import { getCurrentActor, getRequestId } from '@/lib/actor'

export const dynamic = 'force-dynamic'

/**
 * Finding status state machine.
 * A finding in `pending_review` can transition to any terminal state.
 * Terminal states (`approved`/`dismissed`/`escalated`) cannot re-enter
 * `pending_review` or jump to another terminal — they require a separate
 * "revoke" operation (not yet implemented).
 */
const ALLOWED_TRANSITIONS: Record<string, Set<FindingActionT>> = {
  pending_review: new Set<FindingActionT>(['approve', 'dismiss', 'escalate']),
  approved: new Set<FindingActionT>([]),
  dismissed: new Set<FindingActionT>([]),
  escalated: new Set<FindingActionT>([]),
}

const ACTION_TO_STATUS: Record<FindingActionT, string> = {
  approve: 'approved',
  dismiss: 'dismissed',
  escalate: 'escalated',
}

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
    return ok({ finding })
  }
)

export const PATCH = withErrorHandler(
  async (
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    const { id } = await params

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

    // Derive actor from request context (NOT the body — that was the bug).
    const actor = await getCurrentActor()
    const requestId = await getRequestId()

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
          reviewNotes: reviewNotes ?? null,
        },
      })
      await tx.auditLog.create({
        data: {
          actor,
          action,
          entityType: 'finding',
          entityId: id,
          detail: reviewNotes ?? `Finding ${action}ed`,
          requestId: requestId ?? undefined,
        },
      })
      return f
    })

    return ok({ finding: updated })
  }
)
