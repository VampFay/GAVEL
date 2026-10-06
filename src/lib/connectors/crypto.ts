// GAVEL — credential sealing for connectors (AES-256-GCM), with an
// envelope-encryption key-version scheme and a zero-downtime rotation
// path (WP 1.4).
//
// Threat model: the database (SQLite file / PG dumps / provider backups)
// must never contain usable third-party tokens. Keys live ONLY in process
// memory, derived from GAVEL_CONNECTOR_SECRET (falling back to
// GAVEL_JWT_SECRET) — i.e. in the environment, not the database.
//
// Envelope formats on disk (self-describing — the version travels WITH
// the ciphertext, so a mixed-fleet rolling deploy stays readable):
//
//   enc:v1:<iv>:<tag>:<ct>   LEGACY — the original single-key format.
//                            Sealed with the scrypt(secret, 'gavel-connector-v1')
//                            derivation. Still the DEFAULT for sealing until
//                            an operator opts into versioned keys, so
//                            upgrading GAVEL changes no stored bytes.
//
//   enc:k<N>:<iv>:<tag>:<ct>  VERSIONED — key version N (N ≥ 2, set
//                            GAVEL_CONNECTOR_KEY_VERSION=N + a NEW
//                            GAVEL_CONNECTOR_SECRET). Derived with a
//                            per-version salt ('gavel-connector-k<N>') so
//                            versions never share key material.
//
// Rotation (zero downtime, see `bun run crypto:rotate`):
//   1. Set GAVEL_CONNECTOR_SECRET=<new>, GAVEL_CONNECTOR_SECRET_PREVIOUS=<old>,
//      GAVEL_CONNECTOR_KEY_VERSION=<old+1>; deploy. Both old and new
//      instances can READ every envelope (each tries its matching key —
//      GCM auth tags reject wrong keys cleanly).
//   2. Run `bun run crypto:rotate` — re-seals every stored credential
//      under the new active version (idempotent; already-current rows
//      are skipped and counted).
//   3. Unset GAVEL_CONNECTOR_SECRET_PREVIOUS. Done.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const LEGACY_PREFIX = 'enc:v1:'
const LEGACY_SALT = 'gavel-connector-v1'

interface KeyMaterial {
  /** Active sealing secret (GAVEL_CONNECTOR_SECRET → GAVEL_JWT_SECRET → dev fallback). */
  active: string
  /** Rotation-window secret — opens envelopes sealed before rotation. */
  previous: string | null
  /** Active key version. 1 = legacy format. ≥2 = versioned envelopes. */
  version: number
}

const DEV_FALLBACK_SECRET = 'dev-only-DO-NOT-USE-IN-PRODUCTION-connectors'

function keyMaterial(): KeyMaterial {
  const pick = (v: string | undefined): string | null =>
    v && v.length >= 32 ? v : null
  let active = pick(process.env.GAVEL_CONNECTOR_SECRET) ?? pick(process.env.GAVEL_JWT_SECRET)
  if (!active) {
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
    active = DEV_FALLBACK_SECRET
  }
  const previous = pick(process.env.GAVEL_CONNECTOR_SECRET_PREVIOUS)
  const versionRaw = Number(process.env.GAVEL_CONNECTOR_KEY_VERSION ?? '1')
  const version = Number.isInteger(versionRaw) && versionRaw >= 1 ? versionRaw : 1
  return { active, previous, version }
}

// ── Key derivation (memoized per material identity) ────────────────────────

const keyCache = new Map<string, Buffer>()

function derivedKey(secret: string, salt: string): Buffer {
  const cacheKey = `${salt}:${secret.length}:${secret.slice(0, 4)}`
  const hit = keyCache.get(cacheKey)
  if (hit) return hit
  const key = scryptSync(secret, salt, 32)
  keyCache.set(cacheKey, key)
  return key
}

function activeKey(): { key: Buffer; version: number } {
  const m = keyMaterial()
  // Version 1 keeps the ORIGINAL derivation — a fleet can adopt WP 1.4
  // with zero stored-byte changes; only an intentional version bump
  // (≥2) starts writing versioned envelopes.
  const salt = m.version === 1 ? LEGACY_SALT : `gavel-connector-k${m.version}`
  return { key: derivedKey(m.active, salt), version: m.version }
}

/** Test hook: forget derived keys (after changing env in tests). */
export function __resetConnectorKeyForTests(): void {
  keyCache.clear()
}

// ── Sealing ─────────────────────────────────────────────────────────────────

/** Envelope prefix for the ACTIVE configuration. */
export function activeEnvelopePrefix(): string {
  const { version } = activeKey()
  return version === 1 ? LEGACY_PREFIX : `enc:k${version}:`
}

/** Seal a JSON-serializable credential object into the storable string. */
export function sealSecret(plain: unknown): string {
  const { key, version } = activeKey()
  const prefix = version === 1 ? LEGACY_PREFIX : `enc:k${version}:`
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(JSON.stringify(plain), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return (
    prefix +
    iv.toString('base64url') + ':' +
    tag.toString('base64url') + ':' +
    ct.toString('base64url')
  )
}

// ── Opening ─────────────────────────────────────────────────────────────────

function openWith(key: Buffer, iv: Buffer, tag: Buffer, ct: Buffer): unknown {
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return JSON.parse(pt.toString('utf8'))
}

/**
 * Open a sealed credential string. Handles every envelope generation:
 * legacy v1 and versioned k<N>, under the active secret and (during a
 * rotation window) the previous one. Throws on tampering (GCM tag
 * mismatch), wrong keys, or malformed input.
 */
export function openSecret(sealed: string): unknown {
  const m = keyMaterial()
  const versioned = /^enc:k(\d+):/.exec(sealed)
  const isLegacy = sealed.startsWith(LEGACY_PREFIX)
  if (!versioned && !isLegacy) {
    throw new Error('credential blob has unknown format (expected enc:v1 or enc:k<N>)')
  }

  const [ivB64, tagB64, ctB64] = sealed
    .slice(versioned ? versioned[0]!.length : LEGACY_PREFIX.length)
    .split(':')
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error('credential blob is malformed')
  }
  const iv = Buffer.from(ivB64, 'base64url')
  const tag = Buffer.from(tagB64, 'base64url')
  const ct = Buffer.from(ctB64, 'base64url')

  // Candidate keys, most-likely first. GCM rejects wrong keys cleanly
  // (the auth tag check fails), so trying a couple of candidates is both
  // safe and deterministic.
  const candidates: Array<{ key: Buffer; label: string }> = []
  if (versioned) {
    const v = Number(versioned[1])
    const salt = `gavel-connector-k${v}`
    if (v === m.version) {
      candidates.push({ key: derivedKey(m.active, salt), label: `active(k${v})` })
      if (m.previous) candidates.push({ key: derivedKey(m.previous, salt), label: `previous(k${v})` })
    } else {
      if (m.previous) candidates.push({ key: derivedKey(m.previous, salt), label: `previous(k${v})` })
      candidates.push({ key: derivedKey(m.active, salt), label: `active(k${v})` })
    }
  } else {
    // Legacy envelope: sealed with the pre-rotation secret — which is
    // the active one before any rotation, the previous one after.
    candidates.push({ key: derivedKey(m.active, LEGACY_SALT), label: 'active(legacy)' })
    if (m.previous) candidates.push({ key: derivedKey(m.previous, LEGACY_SALT), label: 'previous(legacy)' })
  }

  let lastErr: unknown = null
  for (const c of candidates) {
    try {
      return openWith(c.key, iv, tag, ct)
    } catch (e) {
      lastErr = e
    }
  }
  throw new Error(
    'could not decrypt stored credential — the sealing key changed without completing ' +
    `crypto:rotate, or the blob was tampered with (tried: ${candidates.map(c => c.label).join(', ')}). ` +
    'Re-enter the connector credentials if rotation is complete.'
  )
}

/** Introspection for diagnostics/CLI: which envelope generation a blob is. */
export function envelopeGeneration(sealed: string): string {
  const v = /^enc:k(\d+):/.exec(sealed)
  if (v) return `k${v[1]}`
  if (sealed.startsWith(LEGACY_PREFIX)) return 'legacy-v1'
  return 'unknown'
}
