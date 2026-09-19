import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from '../../scripts/sync-pg-schema'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..', '..')

describe('Postgres schema sync (dual-provider strategy)', () => {
  it('transforms the sqlite provider to postgresql', () => {
    const canonical = readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf8')
    const pg = transform(canonical)
    expect(pg).toContain('provider = "postgresql"')
    expect(pg).not.toContain('provider = "sqlite"')
    // Everything else identical.
    expect(pg.replace('postgresql', 'sqlite')).toBe(canonical.replace('provider = "sqlite"', 'provider = "sqlite"'))
  })

  it('throws when the provider line is missing (schema integrity guard)', () => {
    expect(() => transform('model Foo { id String @id }')).toThrow(/could not find/)
  })

  it('the committed PG schema is in sync (the CI guard, verified locally)', () => {
    const canonical = readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf8')
    const committed = readFileSync(join(ROOT, 'prisma', 'schema.postgres.prisma'), 'utf8')
    expect(committed).toBe(transform(canonical))
  })

  it('the init migration exists and targets postgres', () => {
    expect(existsSync(join(ROOT, 'prisma', 'migrations', '0001_init', 'migration.sql'))).toBe(true)
    const lock = readFileSync(join(ROOT, 'prisma', 'migrations', 'migration_lock.toml'), 'utf8')
    expect(lock).toContain('provider = "postgresql"')
  })
})
