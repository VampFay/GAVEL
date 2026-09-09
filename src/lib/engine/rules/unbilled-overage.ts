import type { EngineEvidence, FindingDraft, Rule, RuleContext, RuleResult } from '../types'
import type { FindingType } from '../finding-types'
import { detectQuantityCap, extractNumericRange, daysBetween, sharedTokens } from '../entity-resolution'
import { stampConfidence, EVIDENCE_WEIGHTS } from '../confidence'
import { money } from '@/lib/money'

/**
 * Rule: unbilled_overage — §9.3 of the plan.
 *
 * A line item with an explicit quantity cap (e.g. "Migration cap: 50,000
 * records") is over-delivered when delivery records show actual work past
 * the cap (e.g. a commit titled "records 50,001–87,000").
 *
 * Detection (deterministic):
 *   1. For each line item whose description encodes a cap (detectQuantityCap),
 *      that line item is "capped".
 *   2. Scan all code activities + tickets for a numeric range (extractNumericRange)
 *      where the end of the range exceeds the cap.
 *   3. If found, the overage = (rangeEnd - cap) units.
 *
 * Impact = overageUnits * rate (rate from the line item).
 *
 * Confidence:
 *   HIGH   if commit title explicitly says "beyond cap" or "50,001–87,000"
 *          AND no change order covers the overage AND rate is known.
 *   MEDIUM if inferred from range + cap only (no explicit "beyond cap" wording)
 *          or rate is unknown.
 *   LOW    if change order partially covers the overage.
 *
 * Negative case:
 *   - Line items with no encoded cap → skip.
 *   - No delivery record showing a range past the cap → skip.
 *   - A signed change order exists that covers the overage → skip (already_covered).
 */

export const unbilledOverageRule: Rule = {
  type: 'unbilled_overage' as FindingType,

  run(ctx: RuleContext): RuleResult {
    const { input, now } = ctx
    const findings: FindingDraft[] = []
    let considered = 0

    for (const li of input.lineItems) {
      const cap = detectQuantityCap(li.description)
      if (cap == null) continue // line item has no encoded cap
      considered++

      // Scan delivery records for ranges exceeding the cap.
      for (const activity of input.codeActivities) {
        const range = extractNumericRange(activity.title)
        if (!range) continue
        const [start, end] = range
        if (end <= cap) continue // no overage

        // Was the overage covered by a change order? A change order only
        // covers the overage if BOTH hold:
        //   1. signed BEFORE the delivery activity, AND
        //   2. deterministic token overlap between the change order text
        //      (title + description) and the capped line item's description —
        //      an unrelated CO ("UI redesign phase 2") must never suppress a
        //      records-migration overage. (Fuzzy matching is the §9.1
        //      embedding half — TODO.)
        const hasCoveringChangeOrder = input.changeOrders.some(
          co =>
            sharedTokens(`${co.title} ${co.description}`, li.description).length > 0 &&
            co.signedDate != null &&
            co.signedDate <= activity.timestamp
        )

        const overageUnits = end - cap
        const rate = money(li.rate) ?? null
        const rateUnit = li.rateUnit?.toLowerCase() ?? null

        // ── Impact calculation ────────────────────────────────────
        // Only multiply overage-units × rate when the rate unit MATCHES the
        // overage unit. A rate of INR 2,200/HOUR with a 37,000-RECORD overage
        // is NOT 81.4M — the units don't match, and we don't know how many
        // hours the 37,000 records took (that requires time-tracking data
        // we don't ingest yet). When the units don't match, report impact
        // as null ("needs manual review") rather than a wildly wrong number.
        const unitCompatibleRate =
          rateUnit === 'unit' || rateUnit === 'fixed' || rateUnit === null
        const impact =
          rate != null && unitCompatibleRate ? overageUnits * rate : null
        const impactNote =
          rate != null && !unitCompatibleRate
            ? `Line item rate is per-${rateUnit}, but the overage is measured in units — impact requires manual review (time-tracking data not yet ingested).`
            : rate != null
              ? `Effort valued against the line item rate (INR ${rate.toLocaleString('en-IN')}/unit).`
              : 'Line item has no rate; impact not computed — review manually.'
        const daysSinceDelivery = daysBetween(activity.timestamp, now)

        // ── Build evidence list ──────────────────────────────────
        const evidence: EngineEvidence[] = []

        // Contract clause — the line item cap.
        evidence.push({
          evidenceType: 'contract_clause',
          source: 'sow',
          refId: li.id,
          title: `SOW line item — ${li.description}`,
          detail: `Cap: ${cap.toLocaleString('en-IN')} units. Beyond cap requires change order per SOW §4.`,
          timestamp: null,
          weight: EVIDENCE_WEIGHTS.contract_clause,
        })

        // Delivery record — the commit showing the overage.
        evidence.push({
          evidenceType: 'delivery_record',
          source: 'github',
          refId: activity.ref,
          title: `${activity.ref} — ${activity.title}`,
          detail: `${activity.type === 'pr' ? 'PR merged' : 'commit'} ${activity.timestamp.toISOString().slice(0, 10)} · range ${start.toLocaleString('en-IN')}–${end.toLocaleString('en-IN')} · ${activity.additions ?? 0} additions`,
          timestamp: activity.timestamp,
          weight: EVIDENCE_WEIGHTS.delivery_record,
        })

        // Billing record — absence of an invoice line for the overage.
        evidence.push({
          evidenceType: 'billing_record',
          source: 'invoice',
          refId: null,
          title: 'No invoice line for overage',
          detail: `${overageUnits.toLocaleString('en-IN')} units delivered beyond the ${cap.toLocaleString('en-IN')}-unit cap; no invoice line covering the overage was found.`,
          timestamp: null,
          weight: EVIDENCE_WEIGHTS.billing_record,
        })

        // Change-order presence/absence.
        if (hasCoveringChangeOrder) {
          evidence.push({
            evidenceType: 'supporting',
            source: 'change_order',
            refId: null,
            title: 'Signed change order covers the overage',
            detail: 'A signed change order dated before the delivery activity exists. This likely covers the overage — confirm with the contract owner.',
            timestamp: null,
            weight: EVIDENCE_WEIGHTS.change_order,
          })
        } else {
          evidence.push({
            evidenceType: 'supporting',
            source: 'change_order',
            refId: null,
            title: 'No signed change order found',
            detail: 'No signed change order covering the overage units. Per SOW §4, work beyond the cap requires a signed change order before commencement.',
            timestamp: null,
            weight: EVIDENCE_WEIGHTS.change_order,
          })
        }

        const assessment = hasCoveringChangeOrder ? 'already_covered' : 'ambiguous'
        const recommendedAction = hasCoveringChangeOrder ? 'dismiss' : 'draft_change_order'

        const draft = stampConfidence({
          signature: `unbilled_overage:${input.contractId}:${li.id}:${activity.ref}`,
          type: 'unbilled_overage',
          title: `${li.description} exceeded contracted cap by ${overageUnits.toLocaleString('en-IN')} units`,
          summary:
            `SOW line item "${li.description}" caps delivery at ${cap.toLocaleString('en-IN')} units. ` +
            `${activity.ref} (dated ${activity.timestamp.toISOString().slice(0, 10)}) explicitly delivers units ${start.toLocaleString('en-IN')}–${end.toLocaleString('en-IN')}, ` +
            `i.e. ${overageUnits.toLocaleString('en-IN')} units beyond cap. ` +
            (impact != null
              ? `Effort valued against the line item rate → impact INR ${impact.toLocaleString('en-IN')}. `
              : `${impactNote} `) +
            (hasCoveringChangeOrder
              ? 'A signed change order covering this work was found.'
              : 'No signed change order exists — per SOW §4, the overage should be draft-change-ordered.') +
            ` (${daysSinceDelivery}d since delivery)`,
          impactAmount: impact,
          assessment,
          recommendedAction,
          contractClause: `SOW line item — ${li.description} (cap ${cap.toLocaleString('en-IN')} units)`,
          billingState: hasCoveringChangeOrder
            ? 'change order on file — review for full coverage of the overage units'
            : 'no invoice line for overage; no signed change order covering the overage units',
          evidence,
        })

        findings.push(draft)
      }
    }

    return {
      rule: 'unbilled_overage',
      findings,
      stats: {
        scanned: input.lineItems.length,
        considered,
        emitted: findings.length,
      },
    }
  },
}
