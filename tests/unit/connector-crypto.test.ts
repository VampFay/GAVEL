import { describe, it, expect, beforeEach } from 'vitest'
import { sealSecret, openSecret, __resetConnectorKeyForTests } from '../../src/lib/connectors/crypto'

beforeEach(() => {
  __resetConnectorKeyForTests()
  delete process.env.GAVEL_CONNECTOR_SECRET
  delete process.env.GAVEL_JWT_SECRET
  process.env.NODE_ENV = 'test'
})

describe('connector credential sealing (AES-256-GCM)', () => {
  it('round-trips a credential object', () => {
    const sealed = sealSecret({ apiToken: 'secret-token-123', email: 'a@b.c' })
    expect(sealed.startsWith('enc:v1:')).toBe(true)
    const opened = openSecret(sealed) as { apiToken: string; email: string }
    expect(opened.apiToken).toBe('secret-token-123')
    expect(opened.email).toBe('a@b.c')
  })

  it('produces a different blob per seal (random IV)', () => {
    const a = sealSecret({ t: 'x' })
    const b = sealSecret({ t: 'x' })
    expect(a).not.toBe(b)
  })

  it('never contains the plaintext', () => {
    const sealed = sealSecret({ apiToken: 'VERY-SECRET-VALUE' })
    expect(sealed.includes('VERY-SECRET-VALUE')).toBe(false)
  })

  it('rejects tampering (GCM auth tag)', () => {
    const sealed = sealSecret({ t: 'x' })
    const parts = sealed.split(':')
    // Flip one character of the ciphertext.
    const ct = parts[3] as string
    parts[3] = (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1)
    expect(() => openSecret(parts.join(':'))).toThrow(/decrypt|tampered/)
  })

  it('rejects a wrong key (secret rotation)', () => {
    const sealed = sealSecret({ t: 'x' })
    process.env.GAVEL_CONNECTOR_SECRET = 'a'.repeat(48) // new key
    __resetConnectorKeyForTests()
    expect(() => openSecret(sealed)).toThrow(/decrypt/)
  })

  it('rejects malformed blobs', () => {
    expect(() => openSecret('not-a-blob')).toThrow(/unknown format/)
    expect(() => openSecret('enc:v1:only-two')).toThrow(/malformed/)
  })

  it('uses GAVEL_CONNECTOR_SECRET over GAVEL_JWT_SECRET when both are set', () => {
    process.env.GAVEL_CONNECTOR_SECRET = 'c'.repeat(48)
    process.env.GAVEL_JWT_SECRET = 'j'.repeat(48)
    const sealed = sealSecret({ t: 'x' })
    // Rotate ONLY the connector secret → blob unreadable.
    process.env.GAVEL_CONNECTOR_SECRET = 'd'.repeat(48)
    __resetConnectorKeyForTests()
    expect(() => openSecret(sealed)).toThrow(/decrypt/)
  })
})
