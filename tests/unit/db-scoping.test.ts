import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SCOPED_MODELS } from '../../src/lib/db'
import { runWithTenant, runUnscoped, getTenantContext } from '../../src/lib/tenant-context'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')

// WP 1.1 — unit coverage for the app/RLS parity contract. The
// PostgreSQL-specific GUC injection + isolation matrix is covered by the
// integration harness (scripts/verify-db-parity.ts) against a real PG 16;
// here we pin the contracts that must hold on EVERY provider.

describe('SCOPED_MODELS ↔ schema ↔ RLS migration parity', () => {
  it('covers every schema model that carries a tenantId column', async () => {
    const schema = await readFile(join(REPO, 'prisma', 'schema.prisma'), 'utf8')
    const models = schema.split('model ').slice(1).map(block => {
      const name = block.slice(0, block.indexOf('{')).trim()
      const body = block.slice(0, block.indexOf('}'))
      return { name, hasTenantId: /tenantId\s+String/.test(body) }
    })
    // Deliberately unscoped at the app layer (documented in src/lib/db.ts):
    // User — login must resolve users before any tenant is known;
    // RateLimitCounter — keyed by IP/identity, no tenant dimension;
    // PurposeToken — random 32-byte capability tokens on role-gated routes;
    // Tenant — the isolation boundary itself.
    const platformModels = new Set(['User', 'RateLimitCounter', 'PurposeToken', 'Tenant'])

    const tenantModels = models.filter(
      m => m.hasTenantId && m.name && !platformModels.has(m.name),
    )
    expect(tenantModels.length).toBe(21)

    for (const m of tenantModels) {
      expect(
        SCOPED_MODELS.has(m.name!),
        `schema model ${m.name} has tenantId but is missing from SCOPED_MODELS`,
      ).toBe(true)
    }
    for (const m of SCOPED_MODELS) {
      expect(
        models.some(x => x.name === m),
        `SCOPED_MODELS entry ${m} not found in prisma/schema.prisma`,
      ).toBe(true)
    }
  })

  it('RLS migrations enable policies on exactly the SCOPED_MODELS tables', async () => {
    const { readdir } = await import('node:fs/promises')
    const migrationsDir = join(REPO, 'prisma', 'migrations')
    const sql = (
      await Promise.all(
        (await readdir(migrationsDir))
          .filter(d => d.startsWith('0'))
          .map(d => readFile(join(migrationsDir, d, 'migration.sql'), 'utf8')),
      )
    ).join('\n')
    const enabled = new Set(
      [...sql.matchAll(/ALTER TABLE "(\w+)"\s+ENABLE ROW LEVEL SECURITY/g)].map(m => m[1]!),
    )
    expect(enabled.size).toBe(SCOPED_MODELS.size)
    for (const m of SCOPED_MODELS) {
      expect(enabled.has(m), `migration 0002 missing ENABLE ROW LEVEL SECURITY for ${m}`).toBe(true)
    }
    // Every policy is scoped to the runtime role and fails closed on an
    // unset GUC (current_setting(..., true) → NULL → no rows).
    expect((sql.match(/CREATE POLICY tenant_isolation ON/g) ?? []).length).toBe(SCOPED_MODELS.size)
    expect((sql.match(/TO gavel_app/g) ?? []).length).toBeGreaterThanOrEqual(SCOPED_MODELS.size)
    expect(sql).toContain("current_setting('app.current_tenant_id', true)")
  })
})

describe('tenant-context decision inputs (app-layer fail-closed)', () => {
  it('runWithTenant establishes the id scoped clients close over', () => {
    let seen: string | null | undefined
    runWithTenant('tenant-x', () => {
      seen = getTenantContext()?.tenantId
    })
    expect(seen).toBe('tenant-x')
  })

  it('runUnscoped marks the context for the CLI/system path', () => {
    let unscoped = false
    runUnscoped(() => {
      unscoped = getTenantContext()?.unscoped === true
    })
    expect(unscoped).toBe(true)
  })

  it('context is absent outside any run (process-level default)', () => {
    expect(getTenantContext()).toBeUndefined()
  })
})
