import { describe, it, expect } from 'vitest'
import { FindingAction } from '../../src/lib/schemas'
import {
  ALLOWED_TRANSITIONS,
  ACTION_TO_STATUS,
  isTransitionAllowed,
} from '../../src/lib/finding-state-machine'

/**
 * Tests for the finding status state machine.
 *
 * The state machine logic lives in src/lib/finding-state-machine.ts —
 * imported here AND by the route handler src/app/api/findings/[id]/route.ts.
 * The previous test file used a hand-copied duplicate of the transition
 * table "to avoid importing the route handler"; that allowed the route's
 * logic to silently diverge from the tested rules. See audit P2-1.
 *
 * Rules:
 *   - pending_review -> approve | dismiss | escalate
 *   - approved       -> (none) — terminal
 *   - dismissed      -> (none) — terminal
 *   - escalated      -> (none) — terminal
 */

describe('finding state machine — table shape', () => {
  it('allows all 3 actions from pending_review', () => {
    for (const action of FindingAction.options) {
      expect(ALLOWED_TRANSITIONS.pending_review.has(action)).toBe(true)
    }
  })

  it('forbids all actions from approved', () => {
    for (const action of FindingAction.options) {
      expect(ALLOWED_TRANSITIONS.approved.has(action)).toBe(false)
    }
  })

  it('forbids all actions from dismissed', () => {
    for (const action of FindingAction.options) {
      expect(ALLOWED_TRANSITIONS.dismissed.has(action)).toBe(false)
    }
  })

  it('forbids all actions from escalated', () => {
    for (const action of FindingAction.options) {
      expect(ALLOWED_TRANSITIONS.escalated.has(action)).toBe(false)
    }
  })

  it('does not allow re-entering pending_review from a terminal state', () => {
    // The set of legal actions from a terminal state must be empty.
    expect(ALLOWED_TRANSITIONS.approved.size).toBe(0)
    expect(ALLOWED_TRANSITIONS.dismissed.size).toBe(0)
    expect(ALLOWED_TRANSITIONS.escalated.size).toBe(0)
  })

  it('does not allow approve -> dismiss (skipping back to pending)', () => {
    expect(ALLOWED_TRANSITIONS.approved.has('dismiss')).toBe(false)
    expect(ALLOWED_TRANSITIONS.approved.has('escalate')).toBe(false)
  })
})

describe('finding state machine — isTransitionAllowed helper', () => {
  it('returns true for all 3 actions from pending_review', () => {
    expect(isTransitionAllowed('pending_review', 'approve')).toBe(true)
    expect(isTransitionAllowed('pending_review', 'dismiss')).toBe(true)
    expect(isTransitionAllowed('pending_review', 'escalate')).toBe(true)
  })

  it('returns false for every action from every terminal state', () => {
    for (const terminal of ['approved', 'dismissed', 'escalated']) {
      for (const action of FindingAction.options) {
        expect(isTransitionAllowed(terminal, action)).toBe(false)
      }
    }
  })

  it('returns false for an unknown current status', () => {
    expect(isTransitionAllowed('banana', 'approve')).toBe(false)
  })

  it('maps each action to the correct next status', () => {
    expect(ACTION_TO_STATUS.approve).toBe('approved')
    expect(ACTION_TO_STATUS.dismiss).toBe('dismissed')
    expect(ACTION_TO_STATUS.escalate).toBe('escalated')
  })
})
