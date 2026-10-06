#!/usr/bin/env bun
// GAVEL — database parity + RLS verification harness (WP 1.1).
//
// The CI gate for environment parity and database-level tenant isolation.
// Fully self-contained: boots an embedded PostgreSQL 16 (same major as the
// postgres:16-alpine dev container), then verifies:
//
//   1. MIGRATIONS APPLY cleanly from scratch (owner connection).
//   2. SCHEMA PARITY — `prisma migrate diff` from the committed migrations
//      to the committed schema.postgres.prisma is EMPTY (transactional
//      validation: migrations are replayed into a shadow database; any
//      drift fails the gate). Complements `bun run schema:check` (which
//      guards schema.prisma → schema.postgres.prisma generation).
//   3. RLS ENABLED on every tenant table + one policy per table, scoped
//      to gavel_app.
//   4. ISOLATION MATRIX at the raw-SQL level:
//        owner sees all rows / app without GUC sees none /
//        app with GUC sees only its tenant / cross-tenant write → 42501.
//   5. APP-LAYER integration — the src/lib/db.ts transaction-wrap path
//      (set_config GUC injection) creates/reads/updates through
//      runWithTenant() exactly as the routes do.
//
// Usage: bun scripts/verify-db-parity.ts [--keep-pg]
// Exit:  0 = all gates pass; 1 = any failure (message printed).

import { spawnSync } from 'node:child_process'
import { Client } from 'pg'
import { bootEmbeddedPg } from './pg-embedded'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url)) + '/..'
let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const TENANT_TABLES = [
  'Alert', 'AuditLog', 'ChangeOrder', 'Client', 'CodeActivity', 'ConnectorSource',
  'Contract', 'Exclusion', 'Finding', 'FindingEvidence', 'Invoice', 'InvoiceLine',
  'LineItem', 'Milestone', 'MonitoredProject', 'Payment', 'Project', 'SyncJob',
  'Ticket', 'TimeEntry', 'WeeklyDriftSnapshot',
]

async function main() {
  console.log('== booting embedded PostgreSQL 16 ==')
  const pg = await bootEmbeddedPg()

  try {
    // ── 1. Fresh schema via owner connection ──────────────────────────────
    console.log('\n== 1. migrations from scratch (owner) ==')
    const superC = new Client({ connectionString: pg.superUrl.replace(/\/gavel$/, '/postgres') })
    await superC.connect()
    await superC.query('DROP DATABASE IF EXISTS gavel_shadow')
    await superC.query('CREATE DATABASE gavel_shadow')
    // prisma migrate diff replays migrations into the shadow DB as
    // gavel_owner (the connection role) — it needs CONNECT + schema rights.
    await superC.query('GRANT ALL ON DATABASE gavel_shadow TO gavel_owner')
    await superC.end()

    const shadowC = new Client({ connectionString: pg.superUrl.replace(/\/gavel$/, '/gavel_shadow') })
    await shadowC.connect()
    await shadowC.query('GRANT ALL ON SCHEMA public TO gavel_owner')
    await shadowC.end()

    const gavelSuper = new Client({ connectionString: pg.superUrl })
    await gavelSuper.connect()
    await gavelSuper.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await gavelSuper.query('ALTER SCHEMA public OWNER TO gavel_owner')
    await gavelSuper.query('GRANT USAGE ON SCHEMA public TO gavel_app')
    await gavelSuper.end()

    const migrate = spawnSync(
      'bunx',
      ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.postgres.prisma'],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: pg.ownerUrl } },
    )
    check('migrate deploy (0001_init + 0002_rls)', migrate.status === 0,
      migrate.status === 0 ? '' : (migrate.stderr || migrate.stdout).slice(-400))

    // ── 2. Transactional schema-drift validation (shadow DB replay) ──────
    console.log('\n== 2. transactional schema parity (shadow-DB replay + diff) ==')
    const diff = spawnSync(
      'bunx',
      ['prisma', 'migrate', 'diff',
        '--from-migrations', 'prisma/migrations',
        '--to-schema-datamodel', 'prisma/schema.postgres.prisma',
        '--shadow-database-url', pg.ownerUrl.replace(/\/gavel$/, '/gavel_shadow')],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: pg.ownerUrl } },
    )
    const diffOut = (diff.stdout || '') + (diff.stderr || '')
    const noDrift = diff.status === 0 && /No difference detected/.test(diffOut)
    check('committed migrations ≡ committed schema (empty diff)', noDrift,
      noDrift ? '' : `exit=${diff.status} :: ${diffOut.slice(-600)}`)

    // ── 3. RLS metadata assertions ────────────────────────────────────────
    console.log('\n== 3. RLS enabled + policies on all tenant tables ==')
    const owner = new Client({ connectionString: pg.ownerUrl })
    await owner.connect()
    for (const t of TENANT_TABLES) {
      const meta = await owner.query<{ rls: boolean; policies: number }>(
        `SELECT (c.relrowsecurity) AS rls,
                (SELECT count(*)::int FROM pg_policies p
                  WHERE p.tablename = $1 AND p.policyname = 'tenant_isolation'
                    AND p.roles::text LIKE '%gavel_app%') AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relname = $1 AND n.nspname = 'public'`, [t])
      const row = meta.rows[0]
      check(`RLS + policy: ${t}`, !!row?.rls && row?.policies === 1)
    }

    // ── 4. Isolation matrix (raw SQL) ─────────────────────────────────────
    console.log('\n== 4. isolation matrix ==')
    await owner.query('DELETE FROM "Client"')
    await owner.query(`INSERT INTO "Tenant" (id, name, slug, "createdAt", "updatedAt")
      VALUES ('p-t1','P1','p1',now(),now()), ('p-t2','P2','p2',now(),now())
      ON CONFLICT (id) DO NOTHING`)
    await owner.query(`INSERT INTO "Client" (id, "tenantId", name, "createdAt", "updatedAt") VALUES
      ('p-c1','p-t1','one',now(),now()), ('p-c2','p-t1','two',now(),now()),
      ('p-c3','p-t2','three',now(),now()) ON CONFLICT (id) DO NOTHING`)

    const app = new Client({ connectionString: pg.appUrl })
    await app.connect()
    check('owner sees all 3 rows', (await owner.query('SELECT count(*)::int n FROM "Client"')).rows[0]!.n === 3)
    check('app without GUC sees 0 rows (fail-closed)',
      (await app.query('SELECT count(*)::int n FROM "Client"')).rows[0]!.n === 0)

    await app.query('BEGIN')
    await app.query("SELECT set_config('app.current_tenant_id', 'p-t1', true)")
    check('app with GUC=p-t1 sees only its 2 rows',
      (await app.query('SELECT count(*)::int n FROM "Client"')).rows[0]!.n === 2)
    let code = ''
    try {
      await app.query(`INSERT INTO "Client" (id, "tenantId", name, "createdAt", "updatedAt")
        VALUES ('p-bad','p-t2','sneaky',now(),now())`)
    } catch (e: any) { code = e.code }
    check('cross-tenant INSERT rejected (42501)', code === '42501', `got ${code || 'NO ERROR'}`)
    await app.query('ROLLBACK')
    await app.end()

    // ── 5. App-layer integration (db.ts GUC path) ─────────────────────────
    console.log('\n== 5. app-layer integration (src/lib/db.ts) ==')
    // The generated Prisma client must be bound to postgresql for this leg.
    const generated = readFileSync(join(ROOT, 'node_modules/.prisma/client/schema.prisma'), 'utf8')
    if (!generated.includes('provider = "postgresql"')) {
      console.log('   (regenerating Prisma client for postgresql)')
      spawnSync('bun', ['scripts/generate.ts'],
        { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: pg.appUrl } })
    }
    const savedUrl = process.env.DATABASE_URL
    process.env.DATABASE_URL = pg.appUrl
    // Import AFTER the env is set so the base client binds to gavel_app.
    const { db } = await import('../src/lib/db')
    const { runWithTenant } = await import('../src/lib/tenant-context')

    await owner.query('DELETE FROM "Client" WHERE id LIKE \'p-app%\'')
    await runWithTenant('p-t1', async () => {
      await db.client.create({ data: { id: 'p-app1', name: 'app layer', tenantId: 'p-t1' }, select: { id: true } })
    })
    let isolated = false
    await runWithTenant('p-t1', async () => {
      const rows = await db.client.findMany({ where: { id: { startsWith: 'p-app' } }, select: { id: true } })
      isolated = rows.length === 1 && rows[0]!.id === 'p-app1'
    })
    check('scoped create+findMany through db.ts (GUC injected)', isolated)

    let txOk = false
    await runWithTenant('p-t1', async () => {
      const n = await db.$transaction(async tx => {
        await tx.client.update({ where: { id: 'p-app1' }, data: { name: 'tx' } })
        return tx.client.count({ where: { id: { startsWith: 'p-app' } } })
      })
      txOk = n === 1
    })
    check('route-pattern db.$transaction (GUC held across statements)', txOk)

    const unscoped = await db.client.count()
    check('unscoped db count = 0 (RLS fail-closed)', unscoped === 0)
    process.env.DATABASE_URL = savedUrl

    // Cleanup probe rows.
    await owner.query('DELETE FROM "Client" WHERE id LIKE \'p-%\'')
    await owner.query('DELETE FROM "Tenant" WHERE id LIKE \'p-t%\'')
    await owner.end()

    // Restore the dev-default SQLite client if this harness switched it —
    // otherwise every SQLite-based tool (dev server, unit tests, the jobs
    // harness) breaks after a parity run.
    const finalGenerated = readFileSync(join(ROOT, 'node_modules/.prisma/client/schema.prisma'), 'utf8')
    if (finalGenerated.includes('provider = "postgresql"') && !savedUrl?.startsWith('postgres')) {
      console.log('\n(restoring the sqlite Prisma client)')
      spawnSync('bun', ['scripts/generate.ts'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: savedUrl ?? '' } })
    }
  } finally {
    if (!process.argv.includes('--keep-pg')) pg.stop()
  }

  console.log(`\n${failures === 0 ? 'ALL PARITY + RLS GATES PASS' : `${failures} FAILURE(S)`}`)
  process.exit(failures === 0 ? 0 : 1)
}

// Suppress the dev-fallback connector-key warning noise from the db import.
process.env.GAVEL_CONNECTOR_SECRET ??= 'x'.repeat(40)
void writeFileSync
void existsSync

main().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1) })
