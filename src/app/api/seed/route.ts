import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { db } from '@/lib/db'
import { withErrorHandler } from '@/lib/api'
import { requireRole } from '@/lib/auth'
import { getRequestId } from '@/lib/actor'

const execFileAsync = promisify(execFile)

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * DANGEROUS endpoint — runs the seed script which calls deleteMany() on
 * every table (including Users) before re-inserting demo data.
 *
 * Hard guards:
 *   1. Returns 404 in production (NODE_ENV === 'production')
 *   2. Admin-role required (was: GAVEL_ADMIN_TOKEN env var)
 *   3. Uses execFile (no shell) with explicit arg array — no injection surface
 *   4. Does NOT echo stdout/stderr to the client (info-disclosure)
 *   5. Writes an audit-log entry attributed to the verified caller.
 *      NOTE: the seed wipes Users and re-creates them with NEW ids, so the
 *      actor id captured before the run is stale afterwards. The audit entry
 *      is written against the POST-SEED user (looked up by email — the demo
 *      seed recreates the same accounts). If the account no longer exists,
 *      actorId is null and the email string carries the attribution.
 *   6. cwd is process.cwd() (was: hardcoded /home/z/my-project — broke any
 *      deployment rooted elsewhere). Resolves to the app root under both
 *      `next dev` and the standalone production server.
 */
export const POST = withErrorHandler(async (req: Request) => {
  // Guard 1: never available in production
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
  }

  // Guard 2: admin role required (replaces the shared bearer token).
  const actor = await requireRole(['admin'])
  const requestId = await getRequestId()

  try {
    // Guard 3: execFile with arg array, no shell
    await execFileAsync(
      'bun',
      ['run', 'scripts/seed.ts'],
      { cwd: process.cwd(), timeout: 60_000, maxBuffer: 1 * 1024 * 1024 }
    )
  } catch (err: unknown) {
    // Server-side log with the real error (the client gets a generic
    // message — no internals leak). The previous implementation swallowed
    // the error entirely, which hid a real FK bug for multiple rounds.
    console.error('[api/seed] seed script failed:', err)
    return NextResponse.json({ ok: false, error: 'seed execution failed' }, { status: 500 })
  }

  // Guard 5: audit-log entry attributed to the caller. Users were just
  // wiped + recreated with new ids — re-resolve by email, fall back to
  // actorId: null (the email string still records who ran it).
  try {
    const freshUser = await db.user.findUnique({ where: { email: actor.email } })
    await db.auditLog.create({
      data: {
        actorId: freshUser?.id ?? null,
        actor: actor.email,
        action: 'seed',
        entityType: 'system',
        entityId: null,
        detail: 'Demo data re-seeded via POST /api/seed',
        requestId: requestId ?? undefined,
      },
    })
  } catch (err: unknown) {
    // The seed itself succeeded — a failed audit append must not turn the
    // whole request into a 500 (the previous bug did exactly that).
    console.error('[api/seed] audit-log append failed:', err)
  }

  // Guard 4: only return ok — never raw seed output
  return NextResponse.json({ ok: true })
})
