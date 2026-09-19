import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { runUnscoped } from '@/lib/tenant-context'

export const dynamic = 'force-dynamic'

/**
 * GET /api/health            — lightweight liveness (SELECT 1 + version).
 * GET /api/health?deep=1     — readiness/diagnostics for monitoring.
 *
 * The deep probe adds ONLY aggregate, non-sensitive diagnostics (no emails,
 * no names): DB latency, provider, object counts, migration table status
 * (Postgres), process uptime + memory. Point your external monitor
 * (UptimeRobot / Better Stack / Grafana agent) at the deep variant — an
 * alert on `ok:false` or `dbLatencyMs > threshold` covers the two failure
 * modes that matter (DB down, DB slow).
 *
 * Auth: exempted (see middleware.ts) — by design, so monitors don't need
 * credentials. The aggregate counts leak nothing about tenants.
 */

function providerFromUrl(url: string): string {
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) return 'postgresql'
  if (url.startsWith('file:')) return 'sqlite'
  if (url.startsWith('mysql://')) return 'mysql'
  return 'unknown'
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const deep = url.searchParams.get('deep') === '1'
  const started = Date.now()

  try {
    await db.$queryRaw`SELECT 1`
    const latency = Date.now() - started

    if (!deep) {
      return NextResponse.json({
        ok: true,
        service: 'gavel',
        version: process.env.npm_package_version ?? '0.0.0',
        sha: process.env.GIT_SHA ?? null,
        timestamp: new Date().toISOString(),
      })
    }

    // Deep probe — aggregate diagnostics only (unscoped on purpose: counts
    // are global platform health, not tenant data).
    const deepInfo = await runUnscoped(async () => {
      const [tenants, users, clients, findings] = await Promise.all([
        db.tenant.count(),
        db.user.count(),
        db.client.count(),
        db.finding.count(),
      ])

      // Migration status (Postgres only — SQLite dev has no _prisma_migrations).
      let migrations: { applied: number; lastAt: Date | null } | null = null
      if (providerFromUrl(process.env.DATABASE_URL ?? '').startsWith('postgres')) {
        try {
          const rows = await db.$queryRaw<Array<{ finished_at: Date | null }>>`
            SELECT finished_at FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC
          `
          migrations = { applied: rows.length, lastAt: rows[0]?.finished_at ?? null }
        } catch {
          migrations = null // table missing → migrations never applied
        }
      }

      return { tenants, users, clients, findings, migrations }
    })

    const mem = process.memoryUsage()
    return NextResponse.json({
      ok: true,
      service: 'gavel',
      version: process.env.npm_package_version ?? '0.0.0',
      sha: process.env.GIT_SHA ?? null,
      db: {
        provider: providerFromUrl(process.env.DATABASE_URL ?? ''),
        latencyMs: latency,
        ...deepInfo,
      },
      process: {
        uptimeSec: Math.round(process.uptime()),
        rssMb: Math.round(mem.rss / 1024 / 1024),
        node: process.version,
        env: process.env.NODE_ENV ?? 'development',
      },
      timestamp: new Date().toISOString(),
    })
  } catch (err: unknown) {
    return NextResponse.json(
      {
        ok: false,
        service: 'gavel',
        error: err instanceof Error ? 'db unreachable' : 'unknown',
        dbLatencyMs: Date.now() - started,
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    )
  }
}
