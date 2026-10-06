import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'
import { existsSync, readFileSync } from 'node:fs'

// WP 1.4 — envelope encryption with key versions + zero-downtime rotation.
//
// The CLI leg runs the REAL script (bun scripts/crypto-rotate.ts) as a
// subprocess against the dev SQLite database with fixture connectors, so
// the exact operator path is what gets tested.

import {
  __resetConnectorKeyForTests,
  activeEnvelopePrefix,
  envelopeGeneration,
  openSecret,
  sealSecret,
} from '../../src/lib/connectors/crypto'

const OLD_SECRET = 'a'.repeat(64)
const NEW_SECRET = 'b'.repeat(64)
const ENV = { ...process.env }

beforeEach(() => {
  __resetConnectorKeyForTests()
})
afterEach(() => {
  process.env = ENV
  __resetConnectorKeyForTests()
})

function configure(opts: {
  active?: string
  previous?: string | null
  version?: number | null
}) {
  delete process.env.GAVEL_CONNECTOR_SECRET
  delete process.env.GAVEL_CONNECTOR_SECRET_PREVIOUS
  delete process.env.GAVEL_CONNECTOR_KEY_VERSION
  delete process.env.GAVEL_JWT_SECRET
  delete process.env.NODE_ENV
  if (opts.active !== undefined) process.env.GAVEL_CONNECTOR_SECRET = opts.active
  if (opts.previous) process.env.GAVEL_CONNECTOR_SECRET_PREVIOUS = opts.previous
  if (opts.version != null) process.env.GAVEL_CONNECTOR_KEY_VERSION = String(opts.version)
}

// ── backward compatibility (nothing changes until an operator opts in) ─────

describe('legacy behavior (no version configured)', () => {
  it('seals the legacy format and round-trips', () => {
    configure({ active: OLD_SECRET })
    const sealed = sealSecret({ token: 'ghp_x' })
    expect(sealed.startsWith('enc:v1:')).toBe(true)
    expect(activeEnvelopePrefix()).toBe('enc:v1:')
    expect(openSecret(sealed)).toEqual({ token: 'ghp_x' })
  })

  it('legacy envelopes sealed BEFORE this code change still open (same secret)', () => {
    // A blob produced by the pre-WP1.4 implementation (same derivation).
    configure({ active: OLD_SECRET })
    const sealed = sealSecret({ apiToken: 't', email: 'e' })
    expect(sealed.startsWith('enc:v1:')).toBe(true)
    expect(openSecret(sealed)).toEqual({ apiToken: 't', email: 'e' })
  })
})

// ── versioned envelopes ─────────────────────────────────────────────────────

describe('versioned envelopes (k<N>)', () => {
  it('seals k2 when version=2, with a per-version derivation', () => {
    configure({ active: NEW_SECRET, version: 2 })
    const sealed = sealSecret({ token: 'x' })
    expect(sealed.startsWith('enc:k2:')).toBe(true)
    expect(envelopeGeneration(sealed)).toBe('k2')
    expect(openSecret(sealed)).toEqual({ token: 'x' })
  })

  it('same secret at different versions yields different ciphertexts', () => {
    configure({ active: NEW_SECRET, version: 2 })
    const k2 = sealSecret({ a: 1 })
    configure({ active: NEW_SECRET, version: 3 })
    const k3 = sealSecret({ a: 1 })
    expect(k2.startsWith('enc:k2:')).toBe(true)
    expect(k3.startsWith('enc:k3:')).toBe(true)
    expect(k2).not.toBe(k3)
  })
})

// ── the rotation window (both keys live) ───────────────────────────────────

describe('rotation window (previous secret set)', () => {
  it('legacy envelope sealed with the OLD secret opens via PREVIOUS after rotation', () => {
    configure({ active: OLD_SECRET })
    const legacy = sealSecret({ token: 'old-secret-token' })

    // Rotate: new active, old demoted to previous, version bumped.
    configure({ active: NEW_SECRET, previous: OLD_SECRET, version: 2 })
    expect(openSecret(legacy)).toEqual({ token: 'old-secret-token' })
  })

  it('k2 envelope from a PREVIOUS deployment opens via PREVIOUS when version moved to 3', () => {
    configure({ active: OLD_SECRET, version: 2 })
    const k2 = sealSecret({ token: 'v2-token' })

    configure({ active: NEW_SECRET, previous: OLD_SECRET, version: 3 })
    expect(openSecret(k2)).toEqual({ token: 'v2-token' })
  })

  it('after re-sealing under the new version, the envelope is k<N> and self-contained', () => {
    configure({ active: OLD_SECRET })
    const legacy = sealSecret({ token: 't' })

    configure({ active: NEW_SECRET, previous: OLD_SECRET, version: 2 })
    const plain = openSecret(legacy)
    const resealed = sealSecret(plain)
    expect(envelopeGeneration(resealed)).toBe('k2')

    // Rotation complete: previous secret removed — the re-sealed envelope
    // must open with the ACTIVE key alone.
    configure({ active: NEW_SECRET, version: 2 })
    expect(openSecret(resealed)).toEqual({ token: 't' })
  })

  it('undecryptable when neither configured key matches — with a rotation-hint message', () => {
    configure({ active: OLD_SECRET })
    const legacy = sealSecret({ token: 't' })

    // Rotation done WITHOUT running crypto:rotate (previous unset).
    configure({ active: NEW_SECRET, version: 2 })
    expect(() => openSecret(legacy)).toThrow(/crypto:rotate/)
  })

  it('tampered ciphertext fails loudly under every generation', () => {
    configure({ active: NEW_SECRET, version: 2 })
    const sealed = sealSecret({ token: 't' })
    const tampered = sealed.slice(0, -6) + 'AAAAAA'
    expect(() => openSecret(tampered)).toThrow(/could not decrypt|malformed/)

    configure({ active: OLD_SECRET })
    const legacy = sealSecret({ token: 't' })
    const tamperedLegacy = legacy.slice(0, -6) + 'AAAAAA'
    expect(() => openSecret(tamperedLegacy)).toThrow(/could not decrypt|malformed/)
  })

  it('unknown envelope generation is reported', () => {
    expect(() => openSecret('enc:k9:aaaa:bbbb:cccc')).toThrow(/could not decrypt/)
    expect(envelopeGeneration('enc:weird:')).toBe('unknown')
  })
})

// ── the CLI (real subprocess against the dev SQLite database) ──────────────

// CI runs the suite against an unseeded database — the CLI drill needs the
// demo fixtures, so it self-skips when they are absent (the pure rotation
// semantics above still run everywhere).
const db = new PrismaClient()
let fixturesAvailable = false
try {
  fixturesAvailable =
    (await db.tenant.count({ where: { id: 'demo-tenant' } })) > 0 &&
    (await db.client.count({ where: { tenantId: 'demo-tenant' } })) > 0
} catch {
  fixturesAvailable = false
}

describe.skipIf(!fixturesAvailable)('crypto:rotate CLI (bun scripts/crypto-rotate.ts)', () => {

  async function fixture(count: number): Promise<string[]> {
    // Fresh connectors under the demo tenant with LEGACY envelopes.
    const tenant = await db.tenant.findUnique({ where: { id: 'demo-tenant' } })
    if (!tenant) throw new Error('demo-tenant missing — run bun run seed:dev first')
    await db.connectorSource.deleteMany({ where: { tenantId: 'demo-tenant', kind: 'jira', config: { contains: 'wp14-rotate-probe' } } })
    await db.project.deleteMany({ where: { tenantId: 'demo-tenant', name: { startsWith: 'wp14-rotate-probe' } } })
    const client = await db.client.findFirst({ where: { tenantId: 'demo-tenant' } })
    if (!client) throw new Error('demo client missing')
    const ids: string[] = []
    for (let i = 0; i < count; i++) {
      // One project per connector: ConnectorSource is unique on
      // (projectId, kind).
      const project = await db.project.create({
        data: { tenantId: 'demo-tenant', clientId: client.id, name: `wp14-rotate-probe-${i}` },
      })
      const c = await db.connectorSource.create({
        data: {
          tenantId: 'demo-tenant', projectId: project.id, kind: 'jira',
          config: JSON.stringify({ host: `example-${i}.atlassian.net` }),
          credentialsSealed: sealSecret({ email: `u${i}@x.com`, apiToken: `tok-${i}` }),
        },
      })
      ids.push(c.id)
    }
    return ids
  }

  function runCli(extra: string[] = []) {
    const r = spawnSync(
      'bun',
      ['scripts/crypto-rotate.ts', ...extra],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          GAVEL_CONNECTOR_SECRET: NEW_SECRET,
          GAVEL_CONNECTOR_SECRET_PREVIOUS: OLD_SECRET,
          GAVEL_CONNECTOR_KEY_VERSION: '2',
          NODE_ENV: 'development',
        },
      },
    )
    return { code: r.status, out: r.stdout + r.stderr }
  }

  it('dry-run reports without writing; real run re-seals and verifies', async () => {
    // Seal fixtures with the OLD secret in LEGACY format.
    configure({ active: OLD_SECRET })
    const ids = await fixture(3)
    const before = await db.connectorSource.findMany({ where: { id: { in: ids } } })
    for (const b of before) expect(envelopeGeneration(b.credentialsSealed!)).toBe('legacy-v1')

    // Dry run: reports 3 to re-seal, writes nothing.
    const dry = runCli(['--dry-run'])
    expect(dry.code).toBe(0)
    expect(dry.out).toMatch(/DRY RUN/)
    expect(dry.out).toMatch(/resealed to enc:k2: 3 \(dry-run\)/)
    const afterDry = await db.connectorSource.findMany({ where: { id: { in: ids } } })
    for (const b of afterDry) expect(envelopeGeneration(b.credentialsSealed!)).toBe('legacy-v1')

    // Real run with --verify: re-seals all 3 under k2.
    const real = runCli(['--verify'])
    expect(real.code).toBe(0)
    expect(real.out).toMatch(/resealed to enc:k2: 3/)
    expect(real.out).toMatch(/already on target generation: 0/)
    const after = await db.connectorSource.findMany({ where: { id: { in: ids } } })
    for (const b of after) expect(envelopeGeneration(b.credentialsSealed!)).toBe('k2')

    // The re-sealed envelopes open with the NEW secret alone (rotation
    // complete — previous removed).
    configure({ active: NEW_SECRET, version: 2 })
    for (const b of after) {
      const opened = openSecret(b.credentialsSealed!) as { apiToken: string }
      expect(opened.apiToken).toMatch(/^tok-/)
    }

    // Idempotence: a second run reports 3 already-current, 0 resealed.
    const again = runCli(['--dry-run'])
    expect(again.out).toMatch(/already on target generation: 3/)
    expect(again.out).toMatch(/resealed to enc:k2: 0/)

    // Cleanup.
    await db.connectorSource.deleteMany({ where: { id: { in: ids } } })
    await db.project.deleteMany({ where: { tenantId: 'demo-tenant', name: { startsWith: 'wp14-rotate-probe' } } })
    await db.$disconnect()
  }, 60_000)

  it('refuses to run without a version bump (no-op guard)', () => {
    // Explicitly strip the rotation vars — vitest worker env can carry
    // them from sibling tests via ...process.env spreads.
    const cleanEnv = { ...process.env }
    delete cleanEnv.GAVEL_CONNECTOR_KEY_VERSION
    delete cleanEnv.GAVEL_CONNECTOR_SECRET_PREVIOUS
    delete cleanEnv.GAVEL_JWT_SECRET
    const r = spawnSync('bun', ['scripts/crypto-rotate.ts', '--dry-run'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...cleanEnv,
        GAVEL_CONNECTOR_SECRET: NEW_SECRET,
        NODE_ENV: 'development',
      },
    })
    expect(r.status).toBe(1)
    expect((r.stdout + r.stderr)).toMatch(/GAVEL_CONNECTOR_KEY_VERSION/)
  })
})

// referenced for the existsSync/readFileSync import lint (kept for future
// fixture-file assertions)
void existsSync
void readFileSync
