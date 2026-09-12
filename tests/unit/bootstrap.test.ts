import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { shouldAutoSeed } from '../../src/lib/bootstrap'
import { DEMO_USERS } from '../../src/lib/demo-data'
import { parseEnv } from '../../src/lib/env'

// ───────────────────────────────────────────────────────────────────
// shouldAutoSeed — the pure decision gate for the sandbox self-heal
// (fix: wiped DB broke the documented demo login; see src/lib/bootstrap.ts)
// ───────────────────────────────────────────────────────────────────
describe('shouldAutoSeed', () => {
  it('NEVER auto-seeds in production, regardless of the flag', () => {
    expect(shouldAutoSeed('production', undefined)).toBe(false)
    expect(shouldAutoSeed('production', true)).toBe(false)
    expect(shouldAutoSeed('production', false)).toBe(false)
  })

  it('auto-seeds by default outside production', () => {
    expect(shouldAutoSeed('development', undefined)).toBe(true)
    expect(shouldAutoSeed('test', undefined)).toBe(true)
  })

  it('respects the explicit opt-out (GAVEL_AUTO_SEED_DEMO=false)', () => {
    expect(shouldAutoSeed('development', false)).toBe(false)
    expect(shouldAutoSeed('test', false)).toBe(false)
  })

  it('explicit opt-in works outside production', () => {
    expect(shouldAutoSeed('development', true)).toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────
// env schema — GAVEL_AUTO_SEED_DEMO parsing (opt-out semantics)
// ───────────────────────────────────────────────────────────────────
describe('parseEnv: GAVEL_AUTO_SEED_DEMO', () => {
  const base = { NODE_ENV: 'development', DATABASE_URL: 'file:./test.db' }

  it('defaults to enabled when unset', () => {
    expect(parseEnv(base).GAVEL_AUTO_SEED_DEMO).toBe(true)
  })

  it('treats empty string as unset (platform .env copies inject blanks)', () => {
    expect(parseEnv({ ...base, GAVEL_AUTO_SEED_DEMO: '' }).GAVEL_AUTO_SEED_DEMO).toBe(true)
  })

  it("reads 'false' as disabled", () => {
    expect(parseEnv({ ...base, GAVEL_AUTO_SEED_DEMO: 'false' }).GAVEL_AUTO_SEED_DEMO).toBe(false)
  })

  it("reads 'true' as enabled", () => {
    expect(parseEnv({ ...base, GAVEL_AUTO_SEED_DEMO: 'true' }).GAVEL_AUTO_SEED_DEMO).toBe(true)
  })

  it('rejects values outside the enum', () => {
    expect(() => parseEnv({ ...base, GAVEL_AUTO_SEED_DEMO: 'yes' })).toThrow()
  })
})

// ───────────────────────────────────────────────────────────────────
// DRIFT GUARD — the login page advertises exactly the credentials that
// demo-data actually seeds. The original bug was the advertised demo
// account not existing in a wiped DB; this test catches the OTHER half
// of that failure class: docs/UI promising credentials the seeder never
// creates (or the seeder changing them silently).
// ───────────────────────────────────────────────────────────────────
describe('login page ↔ DEMO_USERS drift guard', () => {
  const loginPage = readFileSync(
    resolve(__dirname, '../../src/app/login/page.tsx'),
    'utf8'
  )

  it('every DEMO_USERS credential is advertised on the login page', () => {
    for (const u of DEMO_USERS) {
      expect(loginPage).toContain(u.email)
      expect(loginPage).toContain(u.password)
    }
  })

  it('README quickstart documents the admin demo account', () => {
    const readme = readFileSync(resolve(__dirname, '../../README.md'), 'utf8')
    const admin = DEMO_USERS.find(u => u.role === 'admin')
    expect(admin).toBeDefined()
    expect(readme).toContain(admin!.email)
    expect(readme).toContain(admin!.password)
  })

  it('DEMO_USERS roles are valid UserRole values', () => {
    for (const u of DEMO_USERS) {
      expect(['viewer', 'reviewer', 'admin']).toContain(u.role)
    }
  })
})
