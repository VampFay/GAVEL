// Test helper: wipe ALL tables (simulates the sandbox recreating the
// SQLite file empty). Usage: bun run scripts/wipe-db.ts [status]
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const [, , cmd] = process.argv
  if (cmd === 'status') {
    const [users, clients, findings] = await Promise.all([
      db.user.count(),
      db.client.count(),
      db.finding.count(),
    ])
    console.log(JSON.stringify({ users, clients, findings }))
    return
  }
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
  console.log('DB wiped: all tables empty')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
