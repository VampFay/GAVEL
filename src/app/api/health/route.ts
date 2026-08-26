import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/health
 *
 * Lightweight liveness probe — pings the DB with `SELECT 1` and returns
 * the current build SHA (if available via `process.env.GIT_SHA`).
 *
 * Auth: exempted (see middleware.ts).
 */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`
    return NextResponse.json({
      ok: true,
      service: 'shipledger',
      version: process.env.npm_package_version ?? '0.0.0',
      sha: process.env.GIT_SHA ?? null,
      timestamp: new Date().toISOString(),
    })
  } catch (err: unknown) {
    return NextResponse.json(
      {
        ok: false,
        service: 'shipledger',
        error: err instanceof Error ? 'db unreachable' : 'unknown',
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    )
  }
}
