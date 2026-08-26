import type { FindingActionT } from './schemas'

/**
 * Finding status state machine — single source of truth.
 *
 * Both the route handler (`src/app/api/findings/[id]/route.ts`) and the
 * unit test (`tests/unit/finding-state-machine.test.ts`) import from
 * here. The previous test file used a hand-copied duplicate of the
 * transition table "to avoid importing the route handler" — that
 * silently diverged from the real route and the test passed while the
 * route's logic drifted. See audit P2-1.
 *
 * Rules:
 *   - `pending_review` is the only non-terminal state.
 *   - `approve` / `dismiss` / `escalate` are the only legal actions.
 *   - Terminal states (`approved` / `dismissed` / `escalated`) admit
 *     zero actions — a separate "revoke" flow is required to re-enter
 *     `pending_review` (not yet implemented).
 *   - A direct jump between terminal states (e.g. `dismiss` → `escalate`)
 *     is forbidden for the same reason.
 */

export const ALLOWED_TRANSITIONS: Record<string, Set<FindingActionT>> = {
  pending_review: new Set<FindingActionT>(['approve', 'dismiss', 'escalate']),
  approved: new Set<FindingActionT>([]),
  dismissed: new Set<FindingActionT>([]),
  escalated: new Set<FindingActionT>([]),
}

export const ACTION_TO_STATUS: Record<FindingActionT, string> = {
  approve: 'approved',
  dismiss: 'dismissed',
  escalate: 'escalated',
}

/**
 * Check whether `action` is permitted given `currentStatus`.
 * Returns `true` if the transition is allowed, `false` otherwise.
 *
 * Pure function — safe to import from unit tests without spinning up
 * a Prisma client or NextRequest context.
 */
export function isTransitionAllowed(
  currentStatus: string,
  action: FindingActionT
): boolean {
  const allowed = ALLOWED_TRANSITIONS[currentStatus]
  return allowed ? allowed.has(action) : false
}
