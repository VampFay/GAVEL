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
  SHIPLEDGER_ADMIN_TOKEN: z.string().optional(),
  SHIPLEDGER_API_TOKEN: z.string().optional(),

  // Public — exposed to the client bundle by Next.js via the NEXT_PUBLIC_ prefix.
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  NEXT_PUBLIC_ENABLE_RESEED: z
    .enum(['true', 'false'])
    .optional()
    .transform(v => v === 'true'),
})

export type Env = z.infer<typeof envSchema>

let cached: Env | null = null

export function getEnv(): Env {
  if (cached) return cached
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    // Fail fast — print missing/invalid vars, then crash. Better than a
    // half-running server reading `undefined` everywhere.
    console.error('❌ Invalid environment configuration:')
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`)
    }
    throw new Error('Environment validation failed — see logs above.')
  }
  cached = parsed.data
  return cached
}

/** Convenience: true in production. */
export const isProd = () => getEnv().NODE_ENV === 'production'

/** Convenience: true in development. */
export const isDev = () => getEnv().NODE_ENV === 'development'
