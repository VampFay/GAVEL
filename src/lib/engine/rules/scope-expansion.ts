import type { EngineEvidence, FindingDraft, Rule, RuleContext, RuleResult } from '../types'
import type { FindingType } from '../finding-types'
import { matchExclusionToDelivery, extractTicketRefs, findTicketByExternalId, daysBetween } from '../entity-resolution'
import { stampConfidence, EVIDENCE_WEIGHTS } from '../confidence'
import { money } from '@/lib/money'

/**
 * Rule: scope_expansion — §9.3 of the plan.
 *
 * Work was delivered in a category the SOW explicitly excludes.
 *
 * Detection (deterministic):
 *   1. For each contract exclusion (e.g. "Backend hospital EMR
 *      customization is NOT in scope"), tokenize the description.
 *   2. For each code activity (PR/commit) + ticket, check whether its
 *      title has meaningful keyword overlap with the exclusion
 *      description (matchExclusionToDelivery). Require >= 1 shared
 *      significant token (>=4 chars) to reduce false positives.
 *   3. For each match, look for a signed change order covering the work.
 *      If none → finding.
 *
 * Confidence:
 *   HIGH   if commit title explicitly says "out of baseline scope" or
 *          "excluded per §X" AND exclusion is unambiguous.
 *   MEDIUM if keyword overlap is high but no explicit "out of scope"
 *          language in the commit title.
 *   LOW    if only weak keyword match.
 *
 * Impact:
 *   We don't know the actual effort spent on out-of-scope work without
 *   parsing time entries (which we don't have in this stack yet). The
 *   best deterministic proxy is to look at the linked line item's rate *
 *   the time-tracking equivalent (PR additions / typical LOC per hour).
 *   For v1: impact = null (review manually) unless the commit title
 *   explicitly mentions the overage; in that case use the contract's
 *   rate card.
 *
 * Negative case:
 *   - Exclusion has no significant tokens (e.g. "Other work") → skip.
 *   - No delivery record matches → skip.
 *   - A signed change order covers the work → already_covered (skip the
 *     "no CO" finding path).
 */

export const scopeExpansionRule: Rule = {
  type: 'scope_expansion' as FindingType,

  run(ctx: RuleContext): RuleResult {
    const { input, now } = ctx
    const findings: FindingDraft[] = []
    let considered = 0

    for (const exclusion of input.exclusions) {
      // Skip exclusions with no significant tokens (e.g. generic boilerplate).
      // `matchExclusionToDelivery` requires >= 1 shared significant token,
      // so we just call it on every delivery record — if there's no overlap,
      // we get null and skip.

      // Scan code activities (PRs/commits) — these are the strongest
      // signal because their titles often flag the out-of-scope work
      // explicitly (e.g. "EMR prescription endpoint — closes ENG-149
      // (out of baseline scope)").
      for (const activity of input.codeActivities) {
        const shared = matchExclusionToDelivery(exclusion, activity.title)
        if (!shared || shared.length === 0) continue
        considered++

        // ── Look for a signed change order covering this work ───────
        // Heuristic: a change order whose title/description overlaps
        // with the exclusion description. (Deterministic token overlap —
        // not great, but the fuzzy half is §9.1's embedding job.)
        const hasCoveringChangeOrder = input.changeOrders.some(co =>
          matchExclusionToDelivery(exclusion, `${co.title} ${co.description}`) != null &&
          co.signedDate != null && co.signedDate <= activity.timestamp
        )

        // Pull in the linked ticket (if the commit title references one)
        // — adds Jira-side evidence.
        const ticketRefs = extractTicketRefs(activity.title)
        const linkedTickets = ticketRefs
          .map(ref => findTicketByExternalId(input.tickets, ref))
          .filter((t): t is NonNullable<typeof t> => t !== null)

        // ── Build evidence list ──────────────────────────────────
        const evidence: EngineEvidence[] = []

        // Contract clause — the exclusion.
        evidence.push({
          evidenceType: 'contract_clause',
          source: 'sow',
          refId: exclusion.clause,
          title: `SOW ${exclusion.clause ?? '—'} — ${exclusion.description.slice(0, 80)}${exclusion.description.length > 80 ? '…' : ''}`,
          detail: exclusion.description,
          timestamp: null,
          weight: EVIDENCE_WEIGHTS.contract_clause,
        })

        // Delivery record — the commit showing the out-of-scope work.
        evidence.push({
          evidenceType: 'delivery_record',
          source: 'github',
          refId: activity.ref,
          title: `${activity.ref} — ${activity.title}`,
          detail: `${activity.type === 'pr' ? 'PR merged' : 'commit'} ${activity.timestamp.toISOString().slice(0, 10)} by ${activity.author} · ${activity.additions ?? 0} additions / ${activity.filesChanged ?? 0} files · keyword match: ${shared.join(', ')}`,
          timestamp: activity.timestamp,
          weight: EVIDENCE_WEIGHTS.delivery_record,
        })

        // Linked tickets (if any) — corroborating delivery evidence.
        for (const t of linkedTickets) {
          evidence.push({
            evidenceType: 'delivery_record',
            source: 'jira',
            refId: t.externalId,
            title: `${t.externalId} — ${t.title}`,
            detail: `Status: ${t.status} · Assignee: ${t.assignee ?? 'unassigned'} · Updated ${t.externalUpdated ? t.externalUpdated.toISOString().slice(0, 10) : '(unknown)'}`,
            timestamp: t.externalUpdated,
            weight: EVIDENCE_WEIGHTS.delivery_record,
          })
        }

        // Change-order evidence.
        if (hasCoveringChangeOrder) {
          evidence.push({
            evidenceType: 'supporting',
            source: 'change_order',
            refId: null,
            title: 'Signed change order covers this work',
            detail: 'A signed change order whose description overlaps with the exclusion was found. Confirm scope coverage with the contract owner.',
            timestamp: null,
            weight: EVIDENCE_WEIGHTS.change_order,
          })
        } else {
          evidence.push({
            evidenceType: 'supporting',
            source: 'change_order',
            refId: null,
            title: 'No signed change order found',
            detail: 'Per SOW §4, work outside baseline scope requires a signed change order before commencement. Verbal/email-only authorization does NOT meet §4.',
            timestamp: null,
            weight: EVIDENCE_WEIGHTS.change_order,
          })
        }

        // ── Impact + assessment ──────────────────────────────────
        const daysSinceDelivery = daysBetween(activity.timestamp, now)
        // For v1, impact is null unless we can link the work to a rate
        // card entry. The reviewer must compute manually from time-tracking.
        const impactAmount = null
        const assessment = hasCoveringChangeOrder ? 'already_covered' : 'ambiguous'
        const recommendedAction = hasCoveringChangeOrder ? 'dismiss' : 'draft_change_order'

        const draft = stampConfidence({
          signature: `scope_expansion:${input.contractId}:${exclusion.id}:${activity.ref}`,
          type: 'scope_expansion',
          title: `Out-of-scope work delivered: ${shared.join(' / ')} (${exclusion.clause ?? 'no clause ref'})`,
          summary:
            `SOW ${exclusion.clause ?? ''} explicitly excludes: "${exclusion.description}". ` +
            `Delivery activity ${activity.ref} (dated ${activity.timestamp.toISOString().slice(0, 10)}) ` +
            `contains keyword overlap with the exclusion: ${shared.join(', ')}. ` +
            (linkedTickets.length > 0
              ? `Linked tickets: ${linkedTickets.map(t => t.externalId).join(', ')}. `
              : '') +
            (hasCoveringChangeOrder
              ? 'A signed change order covering this work was found — confirm scope coverage.'
              : 'No signed change order exists — per SOW §4, this should be draft-change-ordered.') +
            ` (${daysSinceDelivery}d since delivery)`,
          impactAmount,
          assessment,
          recommendedAction,
          contractClause: `SOW ${exclusion.clause ?? ''} — ${exclusion.description}`,
          billingState: hasCoveringChangeOrder
            ? 'change order on file'
            : 'not billed; risk: delivered scope not recoverable without signed change order',
          evidence,
        })

        findings.push(draft)
      }
    }

    return {
      rule: 'scope_expansion',
      findings,
      stats: {
        scanned: input.exclusions.length,
        considered,
        emitted: findings.length,
      },
    }
  },
}
