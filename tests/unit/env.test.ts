import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseEnv } from '@/lib/env'

/**
 * Env-contract tests. parseEnv is pure (no process.env access, no cache),
 * so each case constructs its own record — no cross-test pollution.
 *
 * The empty-string cases exist because a real `.env.example` with blank
 * `KEY=` lines used to crash startup: zod treats '' as present, so an
 * optional `.min(32)` field rejected a var the user never actually set.
 * Deployment platforms injecting empty strings for unset vars hit the
 * same wall. parseEnv now prunes '' before validating.
 */
describe('parseEnv', () => {
  const base = { DATABASE_URL: 'file:../db/custom.db' }

  // Failure-path tests intentionally trigger parseEnv's console.error —
  // silence it so it doesn't pollute test output.
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accepts the minimal valid config and defaults NODE_ENV to development', () => {
    const env = parseEnv(base)
    expect(env.DATABASE_URL).toBe('file:../db/custom.db')
    expect(env.NODE_ENV).toBe('development')
    expect(env.SHIPLEDGER_JWT_SECRET).toBeUndefined()
    expect(env.SHIPLEDGER_REQUIRE_AUTH).toBe(false)
  })

  it('treats empty strings as unset (the .env.example blank-line trap)', () => {
    // This exact record — a verbatim `cp .env.example .env` — used to fail
    // SHIPLEDGER_JWT_SECRET's min(32) because '' counts as present.
    const env = parseEnv({
      ...base,
      SHIPLEDGER_JWT_SECRET: '',
      NEXT_PUBLIC_APP_URL: '',
      NEXT_PUBLIC_ENABLE_RESEED: '',
      SHIPLEDGER_REQUIRE_AUTH: '',
    })
    expect(env.SHIPLEDGER_JWT_SECRET).toBeUndefined()
    expect(env.NEXT_PUBLIC_APP_URL).toBeUndefined()
    expect(env.NEXT_PUBLIC_ENABLE_RESEED).toBe(false)
    expect(env.SHIPLEDGER_REQUIRE_AUTH).toBe(false)
  })

  it('rejects a JWT secret that is set but too short', () => {
    expect(() =>
      parseEnv({ ...base, SHIPLEDGER_JWT_SECRET: 'short' })
    ).toThrow(/SHIPLEDGER_JWT_SECRET/)
  })

  it('accepts a properly long JWT secret', () => {
    const secret = 'a'.repeat(32)
    expect(parseEnv({ ...base, SHIPLEDGER_JWT_SECRET: secret }).SHIPLEDGER_JWT_SECRET).toBe(secret)
  })

  it('requires DATABASE_URL — missing or blank both fail with the same error', () => {
    expect(() => parseEnv({ NODE_ENV: 'development' })).toThrow(/DATABASE_URL/)
    expect(() => parseEnv({ DATABASE_URL: '' })).toThrow(/DATABASE_URL/)
  })

  it('parses SHIPLEDGER_REQUIRE_AUTH strictly', () => {
    expect(parseEnv({ ...base, SHIPLEDGER_REQUIRE_AUTH: 'true' }).SHIPLEDGER_REQUIRE_AUTH).toBe(true)
    expect(parseEnv({ ...base, SHIPLEDGER_REQUIRE_AUTH: 'false' }).SHIPLEDGER_REQUIRE_AUTH).toBe(false)
    expect(() => parseEnv({ ...base, SHIPLEDGER_REQUIRE_AUTH: 'yes' })).toThrow(
      /SHIPLEDGER_REQUIRE_AUTH/
    )
  })

  it('rejects a malformed NEXT_PUBLIC_APP_URL', () => {
    expect(() => parseEnv({ ...base, NEXT_PUBLIC_APP_URL: 'not-a-url' })).toThrow(
      /NEXT_PUBLIC_APP_URL/
    )
  })

  it('rejects an unknown NODE_ENV value', () => {
    expect(() => parseEnv({ ...base, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/)
  })
})
