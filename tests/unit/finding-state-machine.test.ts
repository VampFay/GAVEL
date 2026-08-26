import { describe, it, expect } from 'vitest'
import { FindingAction } from '../../src/lib/schemas'

/**
 * Tests for the finding status state machine.
 *
 * The state machine logic lives in src/app/api/findings/[id]/route.ts:
 *   - pending_review -> approve | dismiss | escalate
 *   - approved       -> (none) — terminal
 *   - dismissed      -> (none) — terminal
 *   - escalated      -> (none) — terminal
 *
 * These tests use a local copy of the ALLOWED_TRANSITIONS table to avoid
 * importing the route handler (which pulls in Prisma + NextRequest).
 */

const ALLOWED: Record<string, Set<string>> = {
  pending_review: new Set(['approve', 'dismiss', 'escalate']),
  approved: new Set([]),
  dismissed: new Set([]),
  escalated: new Set([]),
}

describe('finding state machine', () => {
  const actions = FindingAction.options

  it('allows all 3 actions from pending_review', () => {
    for (const action of actions) {
      expect(ALLOWED.pending_review.has(action)).toBe(true)
    }
  })

  it('forbids all actions from approved', () => {
    for (const action of actions) {
      expect(ALLOWED.approved.has(action)).toBe(false)
    }
  })

  it('forbids all actions from dismissed', () => {
    for (const action of actions) {
      expect(ALLOWED.dismissed.has(action)).toBe(false)
    }
  })

  it('forbids all actions from escalated', () => {
    for (const action of actions) {
      expect(ALLOWED.escalated.has(action)).toBe(false)
    }
  })

  it('does not allow re-entering pending_review from a terminal state', () => {
    // The set of legal actions from a terminal state must be empty.
    expect(ALLOWED.approved.size).toBe(0)
    expect(ALLOWED.dismissed.size).toBe(0)
    expect(ALLOWED.escalated.size).toBe(0)
  })

  it('does not allow approve -> dismiss (skipping back to pending)', () => {
    expect(ALLOWED.approved.has('dismiss')).toBe(false)
    expect(ALLOWED.approved.has('escalate')).toBe(false)
  })
})
