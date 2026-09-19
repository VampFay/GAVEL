// GAVEL — Postgres schema synchronizer.
//
// The dev sandbox + unit tests run SQLite; production runs PostgreSQL.
// Rather than maintaining two hand-edited schema files (guaranteed to
// drift), this script GENERATES prisma/schema.postgres.prisma from the
// canonical prisma/schema.prisma by swapping the datasource provider.
// The generated file is committed so `prisma migrate deploy` and
// `prisma generate --schema prisma/schema.postgres.prisma` work from a
// fresh checkout without running Bun scripts first.
//
// Usage:
//   bun scripts/sync-pg-schema.ts           # (re)generate the PG schema
//   bun scripts/sync-pg-schema.ts --check   # CI guard: exit 1 on drift
//
// Provider-specific notes:
//   - Everything in the canonical schema is provider-portable today
//     (Decimal, DateTime, String, Int, Float, enums-as-strings). If a
//     genuinely PG-only construct is ever added (pgvector, Json, arrays),
//     extend `transform()` below and keep the sqlite canonical file in
//     sync manually — the --check guard will force the decision to be
//     deliberate instead of silent.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')
const SRC = join(ROOT, 'prisma', 'schema.prisma')
const DST = join(ROOT, 'prisma', 'schema.postgres.prisma')

export function transform(canonical: string): string {
  const swapped = canonical.replace(
    /(datasource\s+db\s*\{[^}]*provider\s*=\s*)"(sqlite)"/,
    '$1"postgresql"'
  )
  if (swapped === canonical) {
    throw new Error('could not find sqlite provider in datasource block — is schema.prisma intact?')
  }
  return swapped
}

function main(): void {
  const canonical = readFileSync(SRC, 'utf8')
  const generated = transform(canonical)
  const check = process.argv.includes('--check')

  if (check) {
    const committed = existsSync(DST) ? readFileSync(DST, 'utf8') : null
    if (committed !== generated) {
      console.error(
        '❌ prisma/schema.postgres.prisma is out of sync with prisma/schema.prisma.\n' +
        '   Run `bun scripts/sync-pg-schema.ts` and commit the result (and regenerate\n' +
        '   the init migration if models changed: see scripts/REGENERATE_MIGRATION note\n' +
        '   in docs/DEPLOYMENT.md).'
      )
      process.exit(1)
    }
    console.log('✅ prisma/schema.postgres.prisma is in sync')
    return
  }

  writeFileSync(DST, generated, 'utf8')
  console.log(`wrote ${DST} (${generated.length} bytes)`)
}

// Run when invoked directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
}
