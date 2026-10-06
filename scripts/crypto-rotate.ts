#!/usr/bin/env bun
// GAVEL — connector-credential key rotation CLI (WP 1.4).
//
//   bun run crypto:rotate [--dry-run] [--verify]
//
// Zero-downtime rotation procedure (full runbook in .env.production.example):
//   1. Set GAVEL_CONNECTOR_SECRET=<NEW secret>,
//      GAVEL_CONNECTOR_SECRET_PREVIOUS=<OLD secret>,
//      GAVEL_CONNECTOR_KEY_VERSION=<previous version + 1> (2 for the first
//      rotation), and deploy. Reads keep working on every envelope
//      generation (each envelope carries its key version).
//   2. Run this CLI: it walks EVERY ConnectorSource row (all tenants —
//      owner/system connection), opens each sealed credential with
//      whichever key matches, and re-seals it under the ACTIVE key
//      version. Idempotent: rows already on the active generation are
//      skipped and counted.
//   3. Unset GAVEL_CONNECTOR_SECRET_PREVIOUS. Rotation complete.
//
// --dry-run   report what would change, write nothing.
// --verify    after rotating, re-open every re-sealed row to prove the
//             new envelopes decrypt (belt-and-braces; the write path
//             already round-trips before committing).
//
// Exit codes: 0 = success (or dry-run reported cleanly), 1 = any failure
// (unknown envelope generation, undecryptable blob with the configured
// keys, database error). Failures list the affected connector ids — the
// operator fixes those rows (re-enter credentials) and re-runs.

import { PrismaClient } from '@prisma/client'
import {
  __resetConnectorKeyForTests,
  activeEnvelopePrefix,
  envelopeGeneration,
  openSecret,
  sealSecret,
} from '../src/lib/connectors/crypto'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const verify = args.includes('--verify')

// System/owner connection: rotation is cross-tenant maintenance by design.
// On PostgreSQL use OWNER_DATABASE_URL (RLS bypass — trusted CLI path);
// on SQLite dev it is simply the base client.
const ownerUrl = process.env.OWNER_DATABASE_URL
function buildDb(): PrismaClient {
  if (ownerUrl) return new PrismaClient({ datasources: { db: { url: ownerUrl } }, log: ['error', 'warn'] })
  return new PrismaClient({ log: ['error', 'warn'] })
}
const db = buildDb()

interface Counts {
  total: number
  resealed: number
  alreadyCurrent: number
  failed: number
  byGeneration: Record<string, number>
}

async function main() {
  __resetConnectorKeyForTests()
  const target = activeEnvelopePrefix()
  console.log(`GAVEL crypto:rotate — target envelope generation: ${target}`)
  if (dryRun) console.log('DRY RUN — no rows will be written\n')

  if (!process.env.GAVEL_CONNECTOR_SECRET && !process.env.GAVEL_JWT_SECRET) {
    console.warn('⚠️  no GAVEL_CONNECTOR_SECRET set — sealing uses the insecure dev fallback. Aborting.')
    process.exit(1)
  }
  if (target === 'enc:v1:' && !process.env.GAVEL_CONNECTOR_KEY_VERSION) {
    console.warn(
      '⚠️  GAVEL_CONNECTOR_KEY_VERSION is not set — the active generation is the legacy\n' +
      '   format (enc:v1:). Rotating to the SAME generation is a no-op.\n' +
      '   Set GAVEL_CONNECTOR_KEY_VERSION=2 (plus the new/previous secrets) first —\n' +
      '   see .env.production.example §Rotation.'
    )
    process.exit(1)
  }

  const rows = await db.connectorSource.findMany({
    select: { id: true, tenantId: true, kind: true, credentialsSealed: true },
    orderBy: { id: 'asc' },
  })

  const counts: Counts = { total: rows.length, resealed: 0, alreadyCurrent: 0, failed: 0, byGeneration: {} }
  const failures: Array<{ id: string; reason: string }> = []

  for (const row of rows) {
    if (!row.credentialsSealed) continue
    const gen = envelopeGeneration(row.credentialsSealed)
    counts.byGeneration[gen] = (counts.byGeneration[gen] ?? 0) + 1

    const current = row.credentialsSealed.startsWith(target)
    if (current) {
      counts.alreadyCurrent++
      continue
    }

    try {
      const plain = openSecret(row.credentialsSealed)
      const resealed = sealSecret(plain)
      if (verify) {
        // Prove the new envelope round-trips before we report it rotated.
        const check = openSecret(resealed)
        if (JSON.stringify(check) !== JSON.stringify(plain)) {
          throw new Error('post-seal round-trip mismatch')
        }
      }
      if (!dryRun) {
        await db.connectorSource.update({
          where: { id: row.id },
          data: { credentialsSealed: resealed },
        })
      }
      counts.resealed++
    } catch (e) {
      counts.failed++
      failures.push({ id: row.id, reason: e instanceof Error ? e.message : String(e) })
    }
  }

  console.log(`\nconnectors with sealed credentials: ${counts.total}`)
  console.log(`  resealed to ${target} ${counts.resealed}${dryRun ? " (dry-run)" : ""}`)
  console.log(`  already on target generation: ${counts.alreadyCurrent}`)
  console.log(`  failed: ${counts.failed}`)
  for (const [gen, n] of Object.entries(counts.byGeneration)) {
    console.log(`  source generations: ${gen} × ${n}`)
  }
  if (failures.length > 0) {
    console.log('\nfailed rows (re-enter these credentials, then re-run):')
    for (const f of failures) console.log(`  - ${f.id}: ${f.reason}`)
  }

  await db.$disconnect()
  process.exit(counts.failed > 0 ? 1 : 0)
}

main().catch(async e => {
  console.error('crypto:rotate fatal:', e)
  await db.$disconnect().catch(() => {})
  process.exit(1)
})
