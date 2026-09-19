// E2E verification of stable demo user ids + the stale-session guard,
// against the RUNNING dev server on :3000.
//
// Scenario (the exact bug from dev.log / the user's screenshots): the user
// is signed in, the DB gets wiped + reseeded ("Reset demo" or a sandbox
// restart), and the browser keeps its 7-day JWT cookie.
//
//   BEFORE the fix: reseed issued NEW cuid user ids → the still-valid cookie
//     referenced a deleted user → POST /api/clients died with a Prisma P2003
//     FK violation on AuditLog.actorId → opaque 500, no recovery hint.
//   AFTER the fix (layer 1): demo users are recreated with STABLE ids, so
//     the same cookie keeps working across reseeds.
//   AFTER the fix (layer 2): if a token DOES reference a nonexistent user
//     (deleted account, legacy pre-fix cookie), requireActor() answers a
//     clean 401 "sign in again" — never a 500.
//
// Uses the real HTTP endpoints, no mocks. Reseeds via POST /api/seed
// (the exact "Reset demo" button path). Leaves the DB in pristine demo
// state afterwards.

import { PrismaClient } from '@prisma/client'
import { signToken } from '../src/lib/auth'
import { DEMO_USERS } from '../src/lib/demo-data'

const db = new PrismaClient()
const BASE = 'http://localhost:3000'

const ADMIN = DEMO_USERS.find(u => u.role === 'admin')!

function cookieOf(res: Response): string {
  const raw = res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? ''
  return raw.split(';')[0] ?? ''
}

async function login(): Promise<{ status: number; cookie: string; body: string }> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password }),
  })
  return { status: res.status, cookie: cookieOf(res), body: await res.text() }
}

async function createClient(cookie: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`${BASE}/api/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      name: `E2E Stale Session Probe ${Date.now()}`,
      industry: 'Custom software development',
      sizeBand: '10-50',
    }),
  })
  return { status: res.status, body: await res.text() }
}

async function me(cookie: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`${BASE}/api/auth/me`, { headers: { cookie } })
  return { status: res.status, body: await res.text() }
}

async function reseedViaApi(cookie: string): Promise<number> {
  const res = await fetch(`${BASE}/api/seed`, { method: 'POST', headers: { cookie } })
  return res.status
}

let failures = 0
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

async function main() {
  console.log('Phase 0 — baseline login on the seeded DB')
  const first = await login()
  check('login as advertised admin succeeds', first.status === 200, `status=${first.status}`)
  const cookie = first.cookie
  check('login sets the auth cookie', cookie.length > 0)

  const me1 = await me(cookie)
  check('GET /api/auth/me with the fresh cookie → 200', me1.status === 200)
  check(
    'the session subject IS the stable id',
    me1.body.includes(ADMIN.id),
    `looking for "${ADMIN.id}" in ${me1.body.slice(0, 120)}`
  )

  const c1 = await createClient(cookie)
  check('POST /api/clients with the fresh cookie → 200 (baseline)', c1.status === 200, `status=${c1.status}`)

  console.log('\nPhase 1 — "Reset demo" (POST /api/seed) with the SAME cookie afterwards')
  const seedStatus = await reseedViaApi(cookie)
  check('POST /api/seed (Reset demo) → 200', seedStatus === 200, `status=${seedStatus}`)

  const dbAdmin = await db.user.findUnique({ where: { email: ADMIN.email }, select: { id: true } })
  check('reseeded admin has the STABLE id again', dbAdmin?.id === ADMIN.id, `db id=${dbAdmin?.id}`)

  const me2 = await me(cookie)
  check('old cookie still authenticates after the reseed (me → 200)', me2.status === 200, `status=${me2.status}`)

  const c2 = await createClient(cookie)
  check(
    'old cookie still creates a client after the reseed → 200 (THE FIX)',
    c2.status === 200,
    `status=${c2.status} body=${c2.body.slice(0, 160)}`
  )

  console.log('\nPhase 2 — stale-session guard: a valid token for a NONEXISTENT user')
  const ghostToken = signToken({ sub: 'user-that-was-deleted', email: 'ghost@gavel.demo', role: 'admin' })
  const ghostCookie = `gavel_token=${ghostToken}`
  const c3 = await createClient(ghostCookie)
  check(
    'stale-sub token gets a clean 401 (NOT a 500 FK crash)',
    c3.status === 401,
    `status=${c3.status} body=${c3.body.slice(0, 160)}`
  )
  const me3 = await me(ghostCookie)
  check('stale-sub token on /api/auth/me → 401 (honest signed-out)', me3.status === 401, `status=${me3.status}`)

  console.log('\nPhase 3 — leave the demo DB pristine')
  const reseedAgain = await reseedViaApi(cookie)
  check('final reseed → 200', reseedAgain === 200, `status=${reseedAgain}`)
  const me4 = await me(cookie)
  check('cookie STILL valid after the final reseed', me4.status === 200, `status=${me4.status}`)
  const clients = await db.client.count()
  check('demo dataset restored (client count back to 1)', clients === 1, `clients=${clients}`)

  await db.$disconnect()
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async e => {
  console.error('verify-stale-session crashed:', e)
  await db.$disconnect()
  process.exit(1)
})
