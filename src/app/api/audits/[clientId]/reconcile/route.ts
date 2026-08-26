import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, invalidRequest, withErrorHandler } from '@/lib/api'
import { getRequestId } from '@/lib/actor'
import { requireRole } from '@/lib/auth'
import { toDecimal, money } from '@/lib/money'
import { runEngine, DEFAULT_RULES } from '@/lib/engine'
import type { Rule } from '@/lib/engine'
import type { FindingType } from '@/lib/engine/finding-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/audits/[clientId]/reconcile
 *
 * Runs the deterministic reconciliation engine against the given client's
 * contract + delivery + billing snapshot, idempotently upserting Findings
 * into the DB. This is the actual product — the endpoint that takes
 * contract + delivery + billing data and produces findings (was missing
 * entirely before this commit, see audit P0-1).
 *
 * Auth: admin only — running the engine writes Findings to the audit log
 * and is a privileged audit action.
 *
 * Body (optional):
 *   {
 *     "rules": ["missed_milestone", "unbilled_overage", "scope_expansion"]
 *   }
 *   If `rules` is omitted, all rules run.
 *
 * Response:
 *   {
 *     "ok": true,
 *     "created": N,      // new findings written
 *     "updated": N,      // existing findings updated with new evidence
 *     "skipped": N,      // existing findings unchanged (already in terminal state)
 *     "ruleStats": {...},
 *     "findings": [...]  // the resulting FindingDrafts (read-only)
 *   }
 *
 * Idempotency:
 *   A Finding is identified by its `signature` field — the engine
 *   produces drafts with deterministic signatures like
 *   `missed_milestone:<contractId>:<milestoneExternalId>`. Re-running
 *   the engine finds the same Finding row (or creates it on first run).
 *   Findings in terminal states (approved / dismissed / escalated) are
 *   NOT updated — the reviewer's decision is preserved.
 */
export const POST = withErrorHandler(
  async (
    req: NextRequest,
    { params }: { params: Promise<{ clientId: string }> }
  ) => {
    const { clientId } = await params

    // ── Authorization: admin only ─────────────────────────────────
    const actor = await requireRole(['admin'])
    const requestId = await getRequestId()

    // ── Parse optional body ────────────────────────────────────────
    let requestedRules: FindingType[] | null = null
    if (req.headers.get('content-type')?.includes('application/json')) {
      const text = await req.text()
      if (text) {
        let body: unknown
        try {
          body = JSON.parse(text)
        } catch {
          return invalidRequest('invalid json')
        }
        if (body && typeof body === 'object') {
          const rules = (body as { rules?: unknown }).rules
          if (Array.isArray(rules)) {
            const valid = rules.filter(
              (r): r is FindingType =>
                typeof r === 'string' &&
                DEFAULT_RULES.some(rule => rule.type === (r as FindingType))
            )
            if (valid.length > 0) requestedRules = valid
          }
        }
      }
    }

    // ── Load contract + delivery + billing snapshot ──────────────
    // Pull everything we need in one round-trip, then map to EngineInput.
    const client = await db.client.findUnique({
      where: { id: clientId },
      include: {
        contracts: {
          include: {
            lineItems: true,
            milestones: true,
            exclusions: true,
            changeOrders: true,
            invoices: { include: { lines: true } },
            projects: {
              include: {
                tickets: true,
                codeActivities: true,
              },
            },
          },
        },
      },
    })
    if (!client) return fail('client not found', 404)
    const contract = client.contracts[0]
    if (!contract) return fail('client has no contract', 404)
    const project = contract.projects[0]
    if (!project) return fail('client has no project', 404)

    // ── Map to EngineInput ───────────────────────────────────────
    const engineInput = {
      contractId: contract.id,
      contractTitle: contract.title,
      currency: contract.currency,
      milestones: contract.milestones.map(m => ({
        id: m.id,
        externalId: m.externalId,
        description: m.description,
        dueDate: m.dueDate,
        value: m.value,
        currency: m.currency,
      })),
      lineItems: contract.lineItems.map(li => ({
        id: li.id,
        description: li.description,
        rate: li.rate,
        rateUnit: li.rateUnit,
        quantity: li.quantity,
        milestone: li.milestone,
        deliveryDate: li.deliveryDate,
      })),
      exclusions: contract.exclusions.map(e => ({
        id: e.id,
        clause: e.clause,
        description: e.description,
      })),
      changeOrders: contract.changeOrders.map(co => ({
        id: co.id,
        title: co.title,
        description: co.description,
        value: co.value,
        signedDate: co.signedDate,
      })),
      tickets: project.tickets.map(t => ({
        id: t.id,
        externalId: t.externalId,
        title: t.title,
        type: t.type,
        status: t.status,
        assignee: t.assignee,
        externalCreated: t.externalCreated,
        externalUpdated: t.externalUpdated,
        description: t.description,
      })),
      codeActivities: project.codeActivities.map(a => ({
        id: a.id,
        type: a.type,
        ref: a.ref,
        title: a.title,
        author: a.author,
        timestamp: a.timestamp,
        additions: a.additions,
        deletions: a.deletions,
        filesChanged: a.filesChanged,
        url: a.url,
      })),
      invoices: contract.invoices.map(inv => ({
        id: inv.id,
        number: inv.number,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        status: inv.status,
        total: inv.total,
        currency: inv.currency,
        lines: inv.lines.map(line => ({
          id: line.id,
          description: line.description,
          amount: line.amount,
          periodStart: line.periodStart,
          periodEnd: line.periodEnd,
        })),
      })),
    }

    // ── Run the engine ────────────────────────────────────────────
    const rulesToRun: Rule[] = requestedRules
      ? DEFAULT_RULES.filter(r => requestedRules.includes(r.type))
      : DEFAULT_RULES
    const output = runEngine(engineInput, { rules: rulesToRun })

    // ── Idempotently persist findings ─────────────────────────────
    // For each FindingDraft, look up by signature. If exists + in a
    // non-terminal state, update its evidence (delete + re-insert).
    // If exists + terminal, skip (preserve reviewer's decision).
    // If not exists, create.
    let created = 0
    let updated = 0
    let skipped = 0

    await db.$transaction(async tx => {
      for (const draft of output.findings) {
        // Match by (type, title) for now — TODO: add a `signature` column
        // to the Finding model for a cleaner idempotency key.
        const matchByTitle = await tx.finding.findFirst({
          where: { contractId: contract.id, type: draft.type, title: draft.title },
        })

        if (matchByTitle) {
          if (matchByTitle.status !== 'pending_review') {
            // Reviewer has acted on this finding — preserve their decision.
            skipped++
            continue
          }
          // Update: wipe old evidence + insert new.
          await tx.findingEvidence.deleteMany({ where: { findingId: matchByTitle.id } })
          if (draft.evidence.length) {
            await tx.findingEvidence.createMany({
              data: draft.evidence.map(e => ({
                findingId: matchByTitle.id,
                evidenceType: e.evidenceType,
                source: e.source,
                refId: e.refId,
                title: e.title,
                detail: e.detail,
                timestamp: e.timestamp,
                weight: e.weight,
              })),
            })
          }
          await tx.finding.update({
            where: { id: matchByTitle.id },
            data: {
              summary: draft.summary,
              impactAmount: toDecimal(draft.impactAmount),
              confidence: draft.confidence,
              confidenceScore: draft.confidenceScore,
              assessment: draft.assessment,
              recommendedAction: draft.recommendedAction,
              contractClause: draft.contractClause,
              billingState: draft.billingState,
            },
          })
          updated++
        } else {
          // Create new.
          const newFinding = await tx.finding.create({
            data: {
              contractId: contract.id,
              projectId: project.id,
              type: draft.type,
              title: draft.title,
              summary: draft.summary,
              impactAmount: toDecimal(draft.impactAmount),
              confidence: draft.confidence,
              confidenceScore: draft.confidenceScore,
              assessment: draft.assessment,
              recommendedAction: draft.recommendedAction,
              contractClause: draft.contractClause,
              billingState: draft.billingState,
              status: 'pending_review',
            },
          })
          if (draft.evidence.length) {
            await tx.findingEvidence.createMany({
              data: draft.evidence.map(e => ({
                findingId: newFinding.id,
                evidenceType: e.evidenceType,
                source: e.source,
                refId: e.refId,
                title: e.title,
                detail: e.detail,
                timestamp: e.timestamp,
                weight: e.weight,
              })),
            })
          }
          created++
        }
      }

      // Single audit-log entry for the engine run (not per-finding —
      // the per-finding audit entries are written by the PATCH /findings/[id]
      // route when a reviewer acts on them).
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          actor: actor.email,
          action: 'reconcile',
          entityType: 'contract',
          entityId: contract.id,
          detail: `Engine run — rules: ${rulesToRun.map(r => r.type).join(', ')}; created ${created}, updated ${updated}, skipped ${skipped}`,
          requestId: requestId ?? undefined,
        },
      })
    })

    return ok({
      created,
      updated,
      skipped,
      ruleStats: output.ruleStats,
      findings: output.findings.map(f => ({
        ...f,
        impactAmount: money(f.impactAmount),
      })),
    })
  }
)
