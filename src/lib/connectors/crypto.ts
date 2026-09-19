// GAVEL — credential sealing for connectors (AES-256-GCM).
//
// Threat model: the database (SQLite file / PG dumps / provider backups)
// must never contain usable third-party tokens. The key lives ONLY in
// process memory, derived from GAVEL_CONNECTOR_SECRET (falling back to
// GAVEL_JWT_SECRET) — i.e., in the environment, not the database.
//
// Format: `enc:v1:<iv-b64url>:<tag-b64url>:<ct-b64url>`
//   v1     — version tag so a future algorithm migration is detectable
//   iv     — 12-byte random nonce per seal (never reused with the same key)
//   tag    — 16-byte GCM auth tag (tamper detection: opening fails loudly)
//
// Key derivation: scrypt(password=secret, salt='gavel-connector-v1',
// keylen=32). The fixed salt is fine here — it exists to domain-separate
// this key from any other scrypt use of the same secret; the secret itself
// is high-entropy random material, not a user password.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const SALT = 'gavel-connector-v1'
const PREFIX = 'enc:v1:'

let cachedKey: Buffer | null = null

function connectorKey(): Buffer {
  if (cachedKey) return cachedKey
  const secret =
    process.env.GAVEL_CONNECTOR_SECRET && process.env.GAVEL_CONNECTOR_SECRET.length >= 32
      ? process.env.GAVEL_CONNECTOR_SECRET
      : process.env.GAVEL_JWT_SECRET && process.env.GAVEL_JWT_SECRET.length >= 32
        ? process.env.GAVEL_JWT_SECRET
        : null
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'GAVEL_CONNECTOR_SECRET (or GAVEL_JWT_SECRET) must be set to >=32 random chars before storing connector credentials'
      )
    }
    // Dev fallback — mirrors the JWT dev secret pattern. Loud on purpose.
    console.warn(
      '⚠️  GAVEL: sealing connector credentials with the insecure dev fallback key. ' +
      'NEVER store production credentials in this state.'
    )
    return scryptSync('dev-only-DO-NOT-USE-IN-PRODUCTION-connectors', SALT, 32)
  }
  cachedKey = scryptSync(secret, SALT, 32)
  return cachedKey
}

/** Test hook: forget the derived key (after changing env in tests). */
export function __resetConnectorKeyForTests(): void {
  cachedKey = null
}

/** Seal a JSON-serializable credential object into the storable string. */
export function sealSecret(plain: unknown): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, connectorKey(), iv)
  const ct = Buffer.concat([cipher.update(JSON.stringify(plain), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return (
    PREFIX +
    iv.toString('base64url') + ':' +
    tag.toString('base64url') + ':' +
    ct.toString('base64url')
  )
}

/**
 * Open a sealed credential string. Throws on tampering (GCM tag mismatch),
 * wrong key (e.g. secret rotated without re-sealing), or malformed input.
 */
export function openSecret(sealed: string): unknown {
  if (!sealed.startsWith(PREFIX)) {
    throw new Error('credential blob has unknown format (expected enc:v1)')
  }
  const [ivB64, tagB64, ctB64] = sealed.slice(PREFIX.length).split(':')
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error('credential blob is malformed')
  }
  try {
    const decipher = createDecipheriv(ALGO, connectorKey(), Buffer.from(ivB64, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
    const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()])
    return JSON.parse(pt.toString('utf8'))
  } catch {
    throw new Error(
      'could not decrypt stored credential — the sealing key changed (rotated secret?) ' +
      'or the blob was tampered with. Re-enter the connector credentials.'
    )
  }
}
