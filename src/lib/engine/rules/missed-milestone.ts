import type { EngineEvidence, FindingDraft, Rule, RuleContext, RuleResult } from '../types'
import type { FindingType } from '../finding-types'
import { findMilestoneBilling, findMilestoneDelivery, daysBetween, findLineItemsForMilestone } from '../entity-resolution'
import { stampConfidence, EVIDENCE_WEIGHTS } from '../confidence'
import { money } from '@/lib/money'

/**
 * Rule: missed_milestone — §9.3 of the plan.
 *
 * A milestone is considered "missed" (or rather, "delivered-but-unbilled")
 * if ALL of the following hold:
 *
 *   1. The milestone's due date is in the past (or it has delivery evidence
 *      with a timestamp past the due date).
 *   2. There is delivery evidence — a code activity (PR/commit/merge) whose
 *      title mentions the milestone's externalId as an ID token (e.g. "M4")
 *      AND/OR a ticket marked done whose title mentions the milestone, OR a
 *      weak description-overlap match (see findMilestoneDelivery). Weak
 *      matches still emit the finding but their evidence rows are stamped
 *      matchStrength 'weak' — capped at 0.10 in the confidence composite so
 *      fuzzy delivery can't reach HIGH on its own.
 *   3. There is NO invoice line whose description mentions the milestone's
 *      externalId, AND no invoice line in the 30-day window after delivery.
 *
 * Output finding:
 *   type             = missed_milestone
 *   impactAmount     = milestone.value (the contractual amount at stake)
 *   assessment       = billable (the work was delivered; billing missed it)
 *   recommendedAction = approve (approve for billing)
 *   confidence:
 *     HIGH  if explicit milestone ID in PR title + milestone value known + > 30d overdue
 *     MEDIUM if delivery evidence is fuzzy (only ticket, no PR) or value unknown
 *     LOW  if delivery date is recent (< 7d) — billing lag is normal
 *
 * Negative case (returns no finding):
 *   - Milestone not yet delivered (no PR/ticket matches) → rule produces no finding
 *   - Milestone delivered AND invoiced → no finding (this rule only catches gaps)
 */

const MISSED_MILESTONE_THRESHOLD_DAYS = 30

export const missedMilestoneRule: Rule = {
  type: 'missed_milestone' as FindingType,

  run(ctx: RuleContext): RuleResult {
    const { input, now } = ctx
    const findings: FindingDraft[] = []
    let considered = 0

    for (const milestone of input.milestones) {
      considered++
      if (!milestone.externalId) continue // can't link delivery without externalId

      // ── 1. Delivery evidence ────────────────────────────────────
      const delivery = findMilestoneDelivery(milestone, {
        codeActivities: input.codeActivities,
        tickets: input.tickets,
      })
      if (
        delivery.activities.length === 0 &&
        delivery.weakActivities.length === 0 &&
        delivery.tickets.length === 0
      ) {
        // No delivery evidence — milestone may simply not be done yet.
        // Not a missed-milestone finding.
        continue
      }

      // Determine the "delivery date" — the timestamp of the latest
      // delivery record (PR merge or ticket close). Weak matches count
      // for the delivery DATE (the work happened — that's the finding's
      // premise); only their CONFIDENCE contribution is capped.
      const deliveryDates: Date[] = []
      for (const a of delivery.activities) deliveryDates.push(a.timestamp)
      for (const a of delivery.weakActivities) deliveryDates.push(a.timestamp)
      for (const t of delivery.tickets) {
        if (t.externalUpdated) deliveryDates.push(t.externalUpdated)
      }
      if (deliveryDates.length === 0) continue
      const deliveryDate = new Date(Math.max(...deliveryDates.map(d => d.getTime())))

      // ── 2. Billing evidence ──────────────────────────────────────
      const billing = findMilestoneBilling(milestone, input.invoices)
      if (billing.lines.length > 0) {
        // Milestone IS invoiced — no finding.
        continue
      }

      // ── 3. Days since delivery ──────────────────────────────────
      const daysSinceDelivery = daysBetween(deliveryDate, now)
      if (daysSinceDelivery < MISSED_MILESTONE_THRESHOLD_DAYS) {
        // Billing lag is normal — don't flag yet.
        continue
      }

      // ── Build evidence list ─────────────────────────────────────
      const evidence: EngineEvidence[] = []

      // Contract clause — the SOW milestone definition.
      evidence.push({
        evidenceType: 'contract_clause',
        source: 'sow',
        refId: milestone.externalId,
        title: `SOW §3 — Milestone ${milestone.externalId}`,
        detail: `${milestone.description} · due ${milestone.dueDate ? milestone.dueDate.toISOString().slice(0, 10) : '(no date)'} · value ${milestone.value ? money(milestone.value) : 'TBD'}`,
        timestamp: milestone.dueDate,
        weight: EVIDENCE_WEIGHTS.contract_clause,
      })

      // Delivery records — each matching PR/commit + each matching ticket.
      // Strong matches (explicit milestone-ID mention) carry the full 0.25
      // weight; weak description-overlap matches are stamped 'weak' and
      // capped at 0.10 in the confidence composite (see confidence.ts).
      for (const a of delivery.activities) {
        evidence.push({
          evidenceType: 'delivery_record',
          source: 'github',
          refId: a.ref,
          title: `${a.ref} — ${a.title}`,
          detail: `${a.type === 'pr' ? 'PR merged' : 'commit'} ${a.timestamp.toISOString().slice(0, 10)} by ${a.author} · ${a.additions ?? 0} additions / ${a.filesChanged ?? 0} files`,
          timestamp: a.timestamp,
          weight: EVIDENCE_WEIGHTS.delivery_record,
          matchStrength: 'strong',
        })
      }
      for (const a of delivery.weakActivities) {
        evidence.push({
          evidenceType: 'delivery_record',
          source: 'github',
          refId: a.ref,
          title: `${a.ref} — ${a.title}`,
          detail: `${a.type === 'pr' ? 'PR merged' : 'commit'} ${a.timestamp.toISOString().slice(0, 10)} by ${a.author} · ${a.additions ?? 0} additions / ${a.filesChanged ?? 0} files · linked by description overlap (no explicit ${milestone.externalId} mention)`,
          timestamp: a.timestamp,
          weight: EVIDENCE_WEIGHTS.delivery_record,
          matchStrength: 'weak',
        })
      }
      for (const t of delivery.tickets) {
        evidence.push({
          evidenceType: 'delivery_record',
          source: 'jira',
          refId: t.externalId,
          title: `${t.externalId} — ${t.title}`,
          detail: `Status: ${t.status} · Assignee: ${t.assignee ?? 'unassigned'} · Updated ${t.externalUpdated ? t.externalUpdated.toISOString().slice(0, 10) : '(unknown)'} · explicit ${milestone.externalId} mention`,
          timestamp: t.externalUpdated,
          weight: EVIDENCE_WEIGHTS.delivery_record,
          matchStrength: 'strong',
        })
      }

      // Billing record — absence is the finding. Document the latest invoice
      // (if any) as "doesn't contain this milestone" evidence.
      const latestInvoice = input.invoices
        .slice()
        .sort((a, b) => b.issueDate.getTime() - a.issueDate.getTime())[0]
      if (latestInvoice) {
        evidence.push({
          evidenceType: 'billing_record',
          source: 'invoice',
          refId: latestInvoice.number,
          title: `${latestInvoice.number} — latest invoice`,
          detail: `Issued ${latestInvoice.issueDate.toISOString().slice(0, 10)} · total ${money(latestInvoice.total)} · no line present for ${milestone.externalId}`,
          timestamp: latestInvoice.issueDate,
          weight: EVIDENCE_WEIGHTS.billing_record,
        })
      } else {
        evidence.push({
          evidenceType: 'billing_record',
          source: 'invoice',
          refId: null,
          title: 'No invoices on file',
          detail: 'No invoice line referencing this milestone was found in the billing record.',
          timestamp: null,
          weight: EVIDENCE_WEIGHTS.billing_record,
        })
      }

      // ── Impact + assessment ──────────────────────────────────────
      const impactAmount = milestone.value ? money(milestone.value) : null
      const daysLate = daysBetween(milestone.dueDate ?? deliveryDate, now)

      // Determine if any line items reference this milestone (helps the
      // reviewer understand which rate-card entry is at stake).
      const linkedLineItems = findLineItemsForMilestone(input.lineItems, milestone.externalId)

      const draft = stampConfidence({
        signature: `missed_milestone:${input.contractId}:${milestone.externalId}`,
        type: 'missed_milestone',
        title: `${milestone.externalId} — ${milestone.description} delivered, no invoice issued`,
        summary:
          `Milestone ${milestone.externalId} (${milestone.description}) shows delivery evidence (PR/ticket linked below) dated ${deliveryDate.toISOString().slice(0, 10)}. ` +
          `Per SOW §3, this triggers ${impactAmount ? `INR ${impactAmount.toLocaleString('en-IN')}` : '(value TBD)'}. ` +
          `As of ${now.toISOString().slice(0, 10)} (${daysSinceDelivery} days since delivery), no invoice line for ${milestone.externalId} exists in the billing record. ` +
          (milestone.dueDate ? `Milestone was due ${milestone.dueDate.toISOString().slice(0, 10)} (${daysLate}d ago). ` : '') +
          (linkedLineItems.length > 0
            ? `Linked line items: ${linkedLineItems.map(li => li.description).join('; ')}.`
            : 'No line items explicitly reference this milestone.'),
        impactAmount,
        assessment: 'billable',
        recommendedAction: 'approve',
        contractClause: `SOW §3 Milestone ${milestone.externalId} — ${milestone.description}: ${milestone.dueDate ? milestone.dueDate.toISOString().slice(0, 10) : '(no date)'} → ${impactAmount ? `INR ${impactAmount.toLocaleString('en-IN')}` : 'TBD'}`,
        billingState: `no invoice line within ${MISSED_MILESTONE_THRESHOLD_DAYS} days of milestone delivery`,
        evidence,
      })

      findings.push(draft)
    }

    return {
      rule: 'missed_milestone',
      findings,
      stats: {
        scanned: input.milestones.length,
        considered,
        emitted: findings.length,
      },
    }
  },
}
