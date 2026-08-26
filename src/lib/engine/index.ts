import type { Rule, EngineInput, EngineOutput, RuleContext } from './types'
import { missedMilestoneRule } from './rules/missed-milestone'
import { unbilledOverageRule } from './rules/unbilled-overage'
import { scopeExpansionRule } from './rules/scope-expansion'

/**
 * Engine orchestrator — §9.3 of the plan.
 *
 * Runs all registered rules against the input snapshot and aggregates
 * their results. Each rule is a pure function — see types.ts Rule.
 *
 * To add a new rule:
 *   1. Implement Rule in src/lib/engine/rules/<name>.ts
 *   2. Import and add to DEFAULT_RULES below.
 *
 * The route handler in src/app/api/audits/[clientId]/reconcile/route.ts
 * is responsible for:
 *   - Reading the contract + delivery + billing rows from the DB.
 *   - Mapping them to the EngineInput shape.
 *   - Calling runEngine(input).
 *   - Persisting each FindingDraft as a `Finding` row (idempotently, via
 *     the `signature` field).
 */

export const DEFAULT_RULES: Rule[] = [
  missedMilestoneRule,
  unbilledOverageRule,
  scopeExpansionRule,
]

// Re-export the Rule type so route handlers can name it without reaching
// into types.ts (the canonical entry point for the engine is this file).
export type { Rule, EngineInput, EngineOutput, RuleContext } from './types'

/**
 * Run the engine with the given rules (defaults to DEFAULT_RULES).
 *
 * Pure: no DB writes. Returns FindingDrafts that the route handler
 * decides how to persist.
 *
 * @param input  snapshot of contract + delivery + billing records
 * @param rules  optional subset of rules to run (default: all)
 * @param now    optional "today" override (default: new Date()) — useful for tests
 */
export function runEngine(
  input: EngineInput,
  opts: { rules?: Rule[]; now?: Date } = {}
): EngineOutput {
  const rules = opts.rules ?? DEFAULT_RULES
  const now = opts.now ?? new Date()
  const ctx: RuleContext = { input, now }

  const allFindings = []
  const ruleStats: EngineOutput['ruleStats'] = {}

  for (const rule of rules) {
    const result = rule.run(ctx)
    allFindings.push(...result.findings)
    ruleStats[rule.type] = result.stats
  }

  return {
    findings: allFindings,
    ruleStats,
  }
}
