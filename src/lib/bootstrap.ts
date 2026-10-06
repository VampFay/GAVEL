// GAVEL — sandbox self-heal bootstrap.
//
// WHY THIS EXISTS (the bug it fixes):
//   The sandbox periodically recreates the SQLite file EMPTY, while the
//   login page keeps advertising `admin@gavel.demo / gavel-admin-demo`.
//   Result: every login attempt returns 401 "invalid email or password"
//   and — because /api/seed requires an already-authenticated admin —
//   there is NO path back to a working state without shell access.
//
// WHAT IT DOES (non-destructive, idempotent):
//   1. Restores any MISSING demo user (never overwrites an existing row —
//      if a real admin changed a demo password, that change survives).
//   2. If the database has ZERO clients (fresh or wiped), restores the
//      full demo dataset so the post-login experience isn't an empty shell.
//
// GUARDS:
//   - NEVER runs when NODE_ENV === 'production' — hard-coded, not env-driven.
//   - Opt-out in dev/test via GAVEL_AUTO_SEED_DEMO=false (e.g. you deleted
//     the demo data on purpose and are provisioning real records).
//   - Single-flight: concurrent callers (startup + parallel login attempts)
//     share one in-flight promise; a failure resets the cache so the next
//     call can retry.
//
// WIRING:
//   - src/instrumentation.ts — server startup (covers wipe-then-restart).
//   - /api/auth/login — retry-on-missing-user (covers wipe-while-running).
//
// SECURITY NOTE: this intentionally makes "user does not exist" logins
// slower ONCE in dev (bootstrap cost on first attempt). Production is
// unaffected. The response stays a generic 401 — no existence oracle.

import { db } from './db'
import { systemDb } from './db-system'
import { getEnv } from './env'
import { ensureDemoUsers, seedDemoDataset } from './demo-data'

/** Pure decision helper (unit-tested): should the self-heal run at all? */
export function shouldAutoSeed(nodeEnv: string | undefined, autoSeedFlag: boolean | undefined): boolean {
  if (nodeEnv === 'production') return false
  return autoSeedFlag !== false
}

let inFlight: Promise<void> | null = null
let lastCompletedAt = 0

// After a successful run, re-check at most this often per process. Bounds
// the cost of the login-retry path (one SELECT per window under failed-login
// load — and the route's rate limiter caps that load anyway) while still
// healing a DB that gets wiped WHILE the server runs.
const RECHECK_WINDOW_MS = 30_000

async function runBootstrap(): Promise<void> {
  const usersCreated = await ensureDemoUsers()
  if (usersCreated.length > 0) {
    console.warn(
      `GAVEL bootstrap: database was missing demo users — restored ${usersCreated.join(', ')}. ` +
      'This is the dev-only self-heal (GAVEL_AUTO_SEED_DEMO=false to disable).'
    )
  }

  // Only re-seed the demo dataset on a database with NO clients — a wiped
  // or brand-new DB. Anything non-empty means real (or deliberately kept)
  // data lives here and must not be touched. Counted via the SYSTEM client:
  // on PostgreSQL the RLS-constrained runtime connection correctly sees
  // zero rows here (no tenant context), which would defeat the check.
  const clientCount = await systemDb.client.count()
  if (clientCount === 0) {
    const summary = await seedDemoDataset()
    console.warn(
      'GAVEL bootstrap: database had zero clients — demo dataset restored ' +
      `(client ${summary.client}, ${summary.findings} findings, ${summary.alerts} alerts). ` +
      'Non-destructive path: nothing pre-existing was deleted.'
    )
  }
}

/**
 * Ensure the documented demo login works. Safe to call on every request:
 *   - concurrent callers share one in-flight run;
 *   - `force=false` callers (server startup) are no-ops within
 *     RECHECK_WINDOW_MS after a successful run;
 *   - `force=true` callers (the login route's failure path) re-check even
 *     inside the window — the DB can be wiped at any moment, and the cost
 *     is bounded by the route's already-executed rate limiter.
 */
export async function ensureDemoData(force = false): Promise<void> {
  // Read env through the sanctioned validator (throws on invalid config,
  // consistent with the rest of the app).
  const env = getEnv()
  if (!shouldAutoSeed(process.env.NODE_ENV, env.GAVEL_AUTO_SEED_DEMO)) return

  if (inFlight) return inFlight
  if (!force && Date.now() - lastCompletedAt < RECHECK_WINDOW_MS) return

  const run = runBootstrap().then(
    () => {
      lastCompletedAt = Date.now()
    },
    (err: unknown) => {
      // Do NOT stamp lastCompletedAt — a failed run (e.g. transient SQLite
      // file lock while the sandbox swaps the DB) must be retryable on the
      // very next call. The route's rate limiter bounds the retry rate.
      throw err
    }
  )
  inFlight = run
  // Clear the slot when done (success OR failure) so future calls re-check.
  // The derived promise swallows its own rejection — callers of `run` still
  // see the error.
  run.finally(() => { inFlight = null }).catch(() => {})
  return run
}

/** Test-only: reset the single-flight cache between unit/integration runs. */
export function __resetBootstrapCacheForTests(): void {
  inFlight = null
  lastCompletedAt = 0
}
