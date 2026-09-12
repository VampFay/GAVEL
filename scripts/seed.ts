// GAVEL — seed script (destructive reset).
//
// Wipes every table and re-inserts the demo dataset. The dataset definition
// itself lives in src/lib/demo-data.ts (single source of truth — the
// non-destructive sandbox bootstrap in src/lib/bootstrap.ts shares it).
//
// Run: bun run seed:dev
//
// Why the wipe stays HERE and only here: deleting data is an explicit,
// CLI-only (or POST /api/seed, admin-gated) operation. The bootstrap never
// deletes anything — it only fills an empty database or creates missing
// demo users.

import { db } from '../src/lib/db'
import { seedDemoDataset } from '../src/lib/demo-data'

async function main() {
  console.log('Seeding GAVEL demo data...')

  // Never allow the destructive path in production, regardless of how the
  // script is invoked (matches the /api/seed route guard).
  if (process.env.NODE_ENV === 'production') {
    throw new Error('refusing to wipe + reseed: NODE_ENV=production')
  }

  // Clean slate — order respects FK dependencies. Includes new tables
  // added during the schema-hardening pass (Milestone, Exclusion, TimeEntry,
  // Payment, WeeklyDriftSnapshot, User, Tenant).
  await db.weeklyDriftSnapshot.deleteMany()
  await db.auditLog.deleteMany()
  await db.alert.deleteMany()
  await db.monitoredProject.deleteMany()
  await db.payment.deleteMany()
  await db.findingEvidence.deleteMany()
  await db.finding.deleteMany()
  await db.invoiceLine.deleteMany()
  await db.invoice.deleteMany()
  await db.timeEntry.deleteMany()
  await db.codeActivity.deleteMany()
  await db.ticket.deleteMany()
  await db.exclusion.deleteMany()
  await db.milestone.deleteMany()
  await db.lineItem.deleteMany()
  await db.changeOrder.deleteMany()
  await db.project.deleteMany()
  await db.contract.deleteMany()
  await db.client.deleteMany()
  await db.user.deleteMany()
  await db.tenant.deleteMany()

  const summary = await seedDemoDataset()

  console.log('Seed complete.')
  console.log({
    client: summary.client,
    contract: summary.contract,
    project: summary.project,
    findings: summary.findings,
    alerts: summary.alerts,
  })
}

main()
  .then(() => db.$disconnect())
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    void db.$disconnect()
    process.exit(1)
  })
