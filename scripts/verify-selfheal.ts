// E2E verification of the sandbox self-heal against the RUNNING dev server.
//
// Scenario (the exact bug from the screenshot): the SQLite file is
// recreated empty while the login page still advertises demo credentials.
//
// Phase A — wipe ONLY the User table (dataset stays) and prove the
//           login route's retry path restores the users and succeeds.
// Phase B — wipe EVERYTHING (all tables) and prove the same login call
//           restores users AND the demo dataset (dashboard has data).
//
// Uses the real HTTP endpoint on :3000, no mocks.

import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const LOGIN = 'http://localhost:3000/api/auth/login'

async function login(): Promise<{ status: number; body: string }> {
  const res = await fetch(LOGIN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@gavel.demo', password: 'gavel-admin-demo' }),
  })
  return { status: res.status, body: await res.text() }
}

async function wipe(onlyUsers: boolean): Promise<void> {
  // Child-first to respect FKs (mirrors scripts/seed.ts order).
  if (!onlyUsers) {
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
  }
  await db.user.deleteMany()
}

let failures = 0
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

async function main() {
  // Baseline: seeded DB, login works
  const before = await login()
  check('baseline login (seeded DB) returns 200', before.status === 200, `status=${before.status}`)

  // ── Phase A: users gone, dataset intact ──────────────────────────
  await wipe(true)
  const usersA = await db.user.count()
  const clientsA = await db.client.count()
  check('phase A setup: 0 users, dataset still present', usersA === 0 && clientsA > 0, `users=${usersA}, clients=${clientsA}`)

  const retryA = await login()
  check('phase A: login self-heals missing users → 200', retryA.status === 200, `status=${retryA.status} body=${retryA.body.slice(0, 80)}`)

  const usersAfter = await db.user.count()
  check('phase A: all 3 demo users restored', usersAfter === 3, `users=${usersAfter}`)

  // ── Phase B: everything gone ─────────────────────────────────────
  await wipe(false)
  const usersB = await db.user.count()
  const clientsB = await db.client.count()
  check('phase B setup: DB fully empty', usersB === 0 && clientsB === 0, `users=${usersB}, clients=${clientsB}`)

  const retryB = await login()
  check('phase B: login self-heals empty DB → 200', retryB.status === 200, `status=${retryB.status} body=${retryB.body.slice(0, 80)}`)

  const [usersAfterB, clientsAfterB, findingsAfterB, alertsAfterB] = await Promise.all([
    db.user.count(),
    db.client.count(),
    db.finding.count(),
    db.alert.count(),
  ])
  check('phase B: users restored', usersAfterB === 3, `users=${usersAfterB}`)
  check('phase B: demo dataset restored (client/contract/findings/alerts)',
    clientsAfterB === 1 && findingsAfterB === 5 && alertsAfterB === 4,
    `clients=${clientsAfterB}, findings=${findingsAfterB}, alerts=${alertsAfterB}`)

  // Auth cookie is usable: /api/auth/me honors the issued token
  const res = await fetch(LOGIN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@gavel.demo', password: 'gavel-admin-demo' }),
  })
  const cookie = res.headers.get('set-cookie')?.split(';')[0] ?? ''
  const me = await fetch('http://localhost:3000/api/auth/me', { headers: { cookie } })
  const meBody = await me.text()
  check('issued cookie authenticates /api/auth/me', me.status === 200, `status=${me.status} body=${meBody.slice(0, 80)}`)

  // Wrong password still 401 (self-heal must not weaken auth)
  const wrong = await fetch(LOGIN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@gavel.demo', password: 'definitely-wrong' }),
  })
  check('wrong password still rejected with 401', wrong.status === 401, `status=${wrong.status}`)

  console.log(failures === 0 ? '\nSELF-HEAL E2E: ALL PASS' : `\nSELF-HEAL E2E: ${failures} FAILURES`)
}

main()
  .catch((e) => {
    console.error('E2E ERROR:', e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
