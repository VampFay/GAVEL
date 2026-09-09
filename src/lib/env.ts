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

  // Public — exposed to the client bundle by Next.js via the NEXT_PUBLIC_ prefix.
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  NEXT_PUBLIC_ENABLE_RESEED: z
    .enum(['true', 'false'])
    .optional()
    .transform(v => v === 'true'),
})

export type Env = z.infer<typeof envSchema>

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
  return cached
}

/** Convenience: true in production. */
export const isProd = () => getEnv().NODE_ENV === 'production'

/** Convenience: true in development. */
export const isDev = () => getEnv().NODE_ENV === 'development'
