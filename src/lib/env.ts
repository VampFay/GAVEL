import { z } from 'zod'

/**
 * Centralized env validation. Import this once at startup (it's safe to
 * import in `next.config.ts`, `src/lib/db.ts`, and API routes) — the schema
 * is parsed once and the result is memoized.
 *
 * Add new vars here as the app grows. Anything not listed here is NOT
 * considered a sanctioned env var and should not be read directly from
 * `process.env`.
 */

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  GAVEL_JWT_SECRET: z.string().min(32, 'GAVEL_JWT_SECRET must be >=32 chars').optional(),
  // Auth fail-safe (audit v2, finding #3): anonymous GET access is a DEV
  // convenience gated on NODE_ENV !== 'production'. If a deploy target
  // doesn't reliably set NODE_ENV=production, set this to 'true' to force
  // the strict (prod) auth behavior regardless of NODE_ENV.
  GAVEL_REQUIRE_AUTH: z
    .enum(['true', 'false'])
    .optional()
    .transform(v => v === 'true'),

  // Sandbox self-heal (fix: wiped DB broke documented demo login). When
  // enabled (default OUTSIDE production only), the server restores the
  // demo users — and, on an empty database, the demo dataset — so the
  // credentials printed on /login keep working after a DB reset.
  // Set to 'false' to disable, e.g. when provisioning real users by hand.
  GAVEL_AUTO_SEED_DEMO: z
    .enum(['true', 'false'])
    .optional()
    .transform(v => v === 'false' ? false : true),

  // Public — exposed to the client bundle by Next.js via the NEXT_PUBLIC_ prefix.
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  NEXT_PUBLIC_ENABLE_RESEED: z
    .enum(['true', 'false'])
    .optional()
    .transform(v => v === 'true'),

  // ── Production hardening (see docs/DEPLOYMENT.md) ──────────────────

  // Rate-limiter store: 'memory' (single process, zero latency) or 'db'
  // (shared across instances, survives restarts — the production default,
  // resolved by callers via effectiveRateLimitStore()).
  GAVEL_RATE_LIMIT_STORE: z.enum(['memory', 'db']).optional(),

  // 32-byte key material for sealing connector credentials (AES-256-GCM).
  // Falls back to GAVEL_JWT_SECRET when unset — acceptable for single-tenant
  // pilots; set explicitly before rotating one without the other.
  GAVEL_CONNECTOR_SECRET: z.string().min(32, 'GAVEL_CONNECTOR_SECRET must be >=32 chars').optional(),

  // ── Connector-credential key rotation (WP 1.4 — see scripts/crypto-rotate.ts) ──
  // Rotation window: the PREVIOUS secret, kept set until crypto:rotate has
  // re-sealed every stored envelope. Key version ≥2 writes versioned
  // envelopes (enc:k<N>:); unset/1 keeps the legacy enc:v1: format.
  GAVEL_CONNECTOR_SECRET_PREVIOUS: z.string().min(32, 'GAVEL_CONNECTOR_SECRET_PREVIOUS must be >=32 chars').optional(),
  GAVEL_CONNECTOR_KEY_VERSION: z.coerce.number().int().min(1).optional(),

  // ── Async sync pipeline (WP 1.2) ──────────────────────────────────
  // Redis for the BullMQ connector-sync queue. Unset → the sync route
  // falls back to inline execution (dev convenience; same code path).
  REDIS_URL: z.string().min(1).optional(),
  // 'queue' (default when REDIS_URL is set) | 'inline' (force in-request).
  GAVEL_SYNC_MODE: z.enum(['queue', 'inline']).optional(),

  // ── Database-level tenancy (WP 1.1 — see migration 0002 + db-system.ts) ──
  // OWNER connection (gavel_owner role): bypasses RLS. CLI/diagnostics ONLY —
  // in production it is ignored by the web process unless the explicit
  // GAVEL_ALLOW_SYSTEM_DB=true opt-in is set (used by /api/health?deep=1).
  OWNER_DATABASE_URL: z.string().min(1).optional(),
  GAVEL_ALLOW_SYSTEM_DB: z
    .enum(['true', 'false'])
    .optional()
    .transform(v => v === 'true'),
})

export type Env = z.infer<typeof envSchema>

/** Effective limiter store: explicit env wins; otherwise db in production, memory in dev/test. */
export function effectiveRateLimitStore(env: Env): 'memory' | 'db' {
  if (env.GAVEL_RATE_LIMIT_STORE) return env.GAVEL_RATE_LIMIT_STORE
  return env.NODE_ENV === 'production' ? 'db' : 'memory'
}

/**
 * Parse an arbitrary env record against the schema. Pure (no process.env
 * access, no caching) so tests can exercise validation directly.
 *
 * Empty-string normalization: deployment platforms (Vercel/Render/Docker
 * .env copies) routinely inject EMPTY strings for vars the user never set.
 * zod treats '' as present, so `.min(32)` / `.url()` would reject vars that
 * are effectively unset — worse, `.env.example`-style templates with blank
 * `KEY=` lines would crash `getEnv()` at startup. Rule: an empty value is
 * the same as an absent one, for every var. (A truly required var that is
 * blank therefore surfaces as "required", which is the clearer error.)
 */
export function parseEnv(record: Record<string, unknown>): Env {
  const pruned = Object.fromEntries(
    Object.entries(record).filter(([, v]) => v !== '' && v !== undefined)
  )
  const parsed = envSchema.safeParse(pruned)
  if (!parsed.success) {
    // Fail fast — print missing/invalid vars, then crash. Better than a
    // half-running server reading `undefined` everywhere. The details go
    // INTO the thrown message too: log aggregation often separates
    // console.error lines from the stack trace, and "which var was wrong"
    // is the one thing an on-call engineer needs first.
    const details = parsed.error.issues
      .map(issue => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    console.error(`❌ Invalid environment configuration:\n${details}`)
    throw new Error(`Environment validation failed:\n${details}`)
  }
  return parsed.data
}

let cached: Env | null = null

export function getEnv(): Env {
  if (cached) return cached
  cached = parseEnv(process.env)
  warnOnProductionGaps(cached)
  return cached
}

/**
 * Non-fatal production configuration warnings. Printed once per process at
 * first env resolution — a missing JWT secret still hard-fails at token
 * signing time (src/lib/auth.ts), but a deploy that somehow serves requests
 * without one should be LOUD in the logs.
 */
function warnOnProductionGaps(env: Env): void {
  if (env.NODE_ENV !== 'production') return
  if (!process.env.GAVEL_JWT_SECRET || process.env.GAVEL_JWT_SECRET.length < 32) {
    console.warn(
      '⚠️  GAVEL: production is running without a real GAVEL_JWT_SECRET. ' +
      'Every auth-related request will fail until it is set (>=32 random chars).'
    )
  }
  if (env.GAVEL_RATE_LIMIT_STORE !== 'memory' && !env.GAVEL_RATE_LIMIT_STORE) {
    // Defaulted to 'db' — informational only.
  }
}

/** Convenience: true in production. */
export const isProd = () => getEnv().NODE_ENV === 'production'

/** Convenience: true in development. */
export const isDev = () => getEnv().NODE_ENV === 'development'
