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
 * DANGEROUS endpoint — runs `bun run scripts/seed.ts` which calls deleteMany()
 * on every table before re-inserting demo data.
 *
 * Hard guards (preserved from the previous implementation):
 *   1. Returns 404 in production (NODE_ENV === 'production')
 *   2. Admin-role required (was: SHIPLEDGER_ADMIN_TOKEN env var). The shared
 *      bearer token is gone — see the auth rewrite in src/lib/auth.ts.
 *   3. Uses execFile (no shell) with explicit arg array — no injection surface
 *   4. Does NOT echo stdout/stderr to the client (info-disclosure)
 *   5. Writes its own audit-log entry at the route layer, attributed to the
 *      verified caller (was: hardcoded `'admin@seed'`).
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
    const { stderr } = await execFileAsync(
      'bun',
      ['run', 'scripts/seed.ts'],
      { cwd: '/home/z/my-project', timeout: 60_000, maxBuffer: 1 * 1024 * 1024 }
    )

    // Guard 5: audit-log entry attributed to the verified caller
    await db.auditLog.create({
      data: {
        actorId: actor.id,
        actor: actor.email,
        action: 'seed',
        entityType: 'system',
        entityId: null,
        detail: 'Demo data re-seeded via POST /api/seed',
        requestId: requestId ?? undefined,
      },
    })

    // Guard 4: only return ok + truncated stderr count, never raw output
    return NextResponse.json({
      ok: true,
      stderrBytes: stderr.length,
    })
  } catch (err: unknown) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? 'seed execution failed' : 'unknown error' },
      { status: 500 }
    )
  }
})
