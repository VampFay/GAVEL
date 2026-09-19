import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  signPurposeToken,
  verifyPurposeToken,
  passwordPolicyError,
  PASSWORD_MIN_LENGTH,
  verifyToken,
  signToken,
} from '../../src/lib/auth'

// Purpose tokens sign with the dev fallback secret in tests — that's fine;
// what matters is the verify semantics, not the key.
beforeEach(() => {
  delete process.env.GAVEL_JWT_SECRET
})

describe('purpose tokens (invite / password reset)', () => {
  it('round-trips an invite token', () => {
    const token = signPurposeToken('invite', 'user-123')
    expect(verifyPurposeToken(token, 'invite')).toBe('user-123')
  })

  it('round-trips a reset token', () => {
    const token = signPurposeToken('reset', 'user-456')
    expect(verifyPurposeToken(token, 'reset')).toBe('user-456')
  })

  it('rejects the wrong purpose (an invite token is not a reset token)', () => {
    const token = signPurposeToken('invite', 'user-123')
    expect(verifyPurposeToken(token, 'reset')).toBeNull()
  })

  it('rejects tampered tokens', () => {
    const token = signPurposeToken('invite', 'user-123')
    const parts = token.split('.')
    const payload = JSON.parse(Buffer.from(parts[1] as string, 'base64url').toString())
    payload.sub = 'attacker'
    parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url')
    expect(verifyPurposeToken(parts.join('.'), 'invite')).toBeNull()
  })

  it('rejects garbage', () => {
    expect(verifyPurposeToken('not.a.token', 'invite')).toBeNull()
    expect(verifyPurposeToken('a.b.c', 'invite')).toBeNull()
  })

  it('invite tokens expire (72h)', () => {
    const token = signPurposeToken('invite', 'u')
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 73 * 60 * 60 * 1000)
    expect(verifyPurposeToken(token, 'invite')).toBeNull()
    vi.useRealTimers()
  })
})

describe('password policy (NIST-style, length-first)', () => {
  it('rejects short passwords', () => {
    expect(passwordPolicyError('short')).toContain('at least')
    expect(passwordPolicyError('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toBeTruthy()
  })

  it('accepts long-enough passwords regardless of composition', () => {
    // No forced composition rules — length is the policy.
    expect(passwordPolicyError('gavel-admin-demo')).toBeNull()
    expect(passwordPolicyError('correct-horse-battery')).toBeNull()
    expect(passwordPolicyError('Tr0ub4dor&3xyz')).toBeNull()
  })

  it('rejects absurdly long passwords and control characters', () => {
    expect(passwordPolicyError('a'.repeat(201))).toContain('at most')
    expect(passwordPolicyError('abc\u0000defghi')).toContain('control')
  })
})

describe('session JWT epoch claims', () => {
  it('carries the epoch and verifies it back', () => {
    const token = signToken({ sub: 'u1', email: 'a@b.c', role: 'admin', epoch: 3 })
    const claims = verifyToken(token)
    expect(claims).not.toBeNull()
    expect(claims?.epoch).toBe(3)
    expect(claims?.sub).toBe('u1')
  })

  it('treats a missing epoch as 0 (legacy token compatibility)', async () => {
    // Hand-build a legacy token without the epoch claim.
    const { createHmac } = await import('node:crypto')
    const secret = 'dev-only-DO-NOT-USE-IN-PRODUCTION-000000000000000000'
    const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url')
    const enc = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' +
      b64(JSON.stringify({ sub: 'u1', email: 'a@b.c', role: 'viewer', iat: 1, exp: 9999999999 }))
    const sig = createHmac('sha256', secret).update(enc).digest('base64url')
    const claims = verifyToken(`${enc}.${sig}`)
    expect(claims?.epoch).toBe(0)
  })
})
