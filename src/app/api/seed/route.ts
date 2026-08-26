import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { db } from '@/lib/db'

const execFileAsync = promisify(execFile)

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * DANGEROUS endpoint — runs `bun run scripts/seed.ts` which calls deleteMany()
 * on every table before re-inserting demo data.
 *
 * Hard guards:
 *   1. Returns 404 in production (NODE_ENV === 'production')
 *   2. Requires SHIPLEDGER_ADMIN_TOKEN env var; client must send `Authorization: Bearer <token>`
 *   3. Uses execFile (no shell) with explicit arg array — no injection surface
 *   4. Does NOT echo stdout/stderr to the client (info-disclosure)
 *   5. Writes its own audit-log entry at the route layer
 */
export async function POST(req: Request) {
  // Guard 1: never available in production
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
  }

  // Guard 2: bearer token check.
  //   - In dev with no token configured: allow (so the sandbox works).
  //   - In dev with token configured: require it.
  //   - In prod: unreachable (Guard 1 already returned 404).
  const expected = process.env.SHIPLEDGER_ADMIN_TOKEN
  if (expected) {
    const auth = req.headers.get('authorization') ?? ''
    const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!supplied || supplied !== expected) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }
  }

  try {
    // Guard 3: execFile with arg array, no shell
    const { stderr } = await execFileAsync(
      'bun',
      ['run', 'scripts/seed.ts'],
      { cwd: '/home/z/my-project', timeout: 60_000, maxBuffer: 1 * 1024 * 1024 }
    )

    // Guard 5: audit-log entry from the route layer
    await db.auditLog.create({
      data: {
        actor: 'admin@seed',
        action: 'seed',
        entityType: 'system',
        entityId: null,
        detail: 'Demo data re-seeded via POST /api/seed',
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
}
