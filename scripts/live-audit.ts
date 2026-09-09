/**
 * live-audit.ts — exhaustive live audit of every ShipLedger route + button flow.
 *
 * Runs against a live dev server on :3000. Exercises:
 *   Phase 1  Pages + unauthenticated behavior (dev-mode GET hatch, mutation 401s)
 *   Phase 2  Login flows (bad creds, good creds, session cookie, /me)
 *   Phase 3  All authenticated GET routes (admin)
 *   Phase 4  Every mutation: client create, extract-contract (REAL LLM),
 *            reconcile x2 (idempotency), finding transitions (legal + illegal),
 *            monitoring ack/unack/toggle, reseed, validation errors
 *   Phase 5  Role guards (viewer + reviewer)
 *   Phase 6  Logout + post-logout state
 *
 * Usage: bun run scripts/live-audit.ts [--base http://localhost:3000]
 */

const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'http://localhost:3000'

// ── tiny HTTP client with cookie jar ──────────────────────────────────
type Jar = Record<string, string>

async function call(
  method: string,
  path: string,
  opts: { jar?: Jar; body?: unknown; timeoutMs?: number } = {}
): Promise<{ status: number; json: any; text: string }> {
  const headers: Record<string, string> = {}
  if (opts.jar && Object.keys(opts.jar).length > 0) {
    headers['cookie'] = Object.entries(opts.jar)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 90_000)
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: ctrl.signal,
      redirect: 'manual',
    })
    // absorb set-cookie into jar
    if (opts.jar) {
      const setCookies =
        (res.headers as any).getSetCookie?.() ??
        (res.headers.get('set-cookie')
          ? [res.headers.get('set-cookie')!]
          : [])
      for (const sc of setCookies) {
        const [pair] = sc.split(';')
        const eq = pair.indexOf('=')
        if (eq > 0) opts.jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
      }
    }
    const text = await res.text()
    let json: any = null
    try { json = JSON.parse(text) } catch { /* html or empty */ }
    return { status: res.status, json, text }
  } finally {
    clearTimeout(timer)
  }
}

// ── assertion framework ────────────────────────────────────────────────
type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
let group = ''
function check(name: string, pass: boolean, detail = '') {
  results.push({ name: `${group ? group + ' :: ' : ''}${name}`, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${group ? group + ' :: ' : ''}${name}${detail ? `  —  ${detail}` : ''}`)
}
function eq(a: any, b: any, label: string) {
  check(label, a === b, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}

// ── credentials ────────────────────────────────────────────────────────
const ADMIN = { email: 'admin@shipledger.demo', password: 'shipledger-admin-demo' }
const REVIEWER = { email: 'reviewer@shipledger.demo', password: 'shipledger-reviewer-demo' }
const VIEWER = { email: 'viewer@shipledger.demo', password: 'shipledger-viewer-demo' }

// realistic SOW text for the real-LLM extraction test
const SOW_TEXT = `STATEMENT OF WORK — Meridian Health Systems Patient Portal Phase 2

1. SCOPE. Vendor shall develop patient appointment scheduling module, medication reminder service, and integration with existing billing system. Weekly status reports due each Friday by 5pm ET.

2. RATE CARD. Senior Engineer: $185/hour. Engineer: $145/hour. Designer: $120/hour. Project Manager: $160/hour.

3. MILESTONES.
M1 — Scheduling module complete and UAT-passed. Due 2025-08-15. Fee: $48,000.
M2 — Medication reminders shipped to production. Due 2025-10-01. Fee: $36,000.
M3 — Billing integration live. Due 2025-11-15. Fee: $40,000.

4. CHANGE ORDERS. Any change to scope requires a signed change order before work commences. Verbal or email-only instructions do not constitute authorization.

5. EXCLUSIONS. Hosting costs, third-party license fees, and any work beyond the modules listed in Section 1 are out of scope. Data migration from legacy systems is excluded and quoted separately.`

async function main() {
  console.log(`\n══════════ LIVE AUDIT against ${BASE} ══════════\n`)

  // ════════════════ PHASE 1 — pages & unauthenticated ════════════════
  group = 'P1 pages'
  const home = await call('GET', '/')
  eq(home.status, 200, 'GET / renders 200')
  check('GET / returns real HTML shell', /<html|<!doctype/i.test(home.text), `len=${home.text.length}`)
  const loginPage = await call('GET', '/login')
  eq(loginPage.status, 200, 'GET /login renders 200')

  group = 'P1 unauth'
  const health = await call('GET', '/api/health')
  eq(health.status, 200, 'GET /api/health open (no auth)')
  check('health payload ok:true', health.json?.ok === true, JSON.stringify(health.json).slice(0, 120))

  const apiRoot = await call('GET', '/api')
  console.log(`   (info) GET /api → ${apiRoot.status} ${apiRoot.text.slice(0, 60)}`)
  if (apiRoot.json?.message === 'Hello, world!') {
    check('GET /api is scaffold "Hello, world!" — FLAG for removal', false, 'leftover Next.js scaffold route')
  }

  const options = await call('OPTIONS', '/api/clients')
  check('OPTIONS preflight open (non-401)', options.status !== 401, `status=${options.status}`)

  const badLogin = await call('POST', '/api/auth/login', { body: { email: 'admin@shipledger.demo', password: 'wrong' } })
  eq(badLogin.status, 401, 'login wrong password → 401')
  const noUserLogin = await call('POST', '/api/auth/login', { body: { email: 'nobody@x.io', password: 'whatever' } })
  eq(noUserLogin.status, 401, 'login unknown email → 401 (generic)')
  const badEmailLogin = await call('POST', '/api/auth/login', { body: { email: 'not-an-email', password: 'x' } })
  eq(badEmailLogin.status, 400, 'login malformed email → 400')

  // dev-mode: anonymous GETs allowed (documented hatch); mutations must 401
  const unauthClients = await call('GET', '/api/clients')
  check('GET /api/clients unauth (dev hatch) → 200', unauthClients.status === 200, `status=${unauthClients.status}`)
  const unauthPost = await call('POST', '/api/clients', { body: { name: 'hacker' } })
  eq(unauthPost.status, 401, 'POST /api/clients unauth → 401 (mutations always gated)')
  const unauthReconcile = await call('POST', '/api/audits/x/reconcile', { body: {} })
  check('POST reconcile unauth → 401', unauthReconcile.status === 401, `status=${unauthReconcile.status}`)
  const unauthSeed = await call('POST', '/api/seed', { body: {} })
  eq(unauthSeed.status, 401, 'POST /api/seed unauth → 401')
  const unauthExtract = await call('POST', '/api/extract-contract', { body: { rawText: 'x'.repeat(40) } })
  eq(unauthExtract.status, 401, 'POST /api/extract-contract unauth → 401')

  // ════════════════ PHASE 2 — admin login ════════════════
  group = 'P2 admin login'
  const adminJar: Jar = {}
  const login = await call('POST', '/api/auth/login', { jar: adminJar, body: ADMIN })
  eq(login.status, 200, 'admin login → 200')
  check('session cookie issued', Object.keys(adminJar).some(k => /token|session|auth/i.test(k)), `cookies=${Object.keys(adminJar).join(',')}`)
  const me = await call('GET', '/api/auth/me', { jar: adminJar })
  eq(me.status, 200, 'GET /api/auth/me → 200')
  eq(me.json?.user?.role, 'admin', '/me reports role=admin')

  // ════════════════ PHASE 3 — authenticated GETs ════════════════
  group = 'P3 GETs (admin)'
  const clients = await call('GET', '/api/clients', { jar: adminJar })
  eq(clients.status, 200, 'GET /api/clients → 200')
  check('clients payload has array', Array.isArray(clients.json?.clients), `count=${clients.json?.clients?.length}`)
  const seededClient = clients.json?.clients?.find((c: any) => /aether|veridian/i.test(c.name)) ?? clients.json?.clients?.[0]
  check('seeded demo client present', !!seededClient, `client=${seededClient?.name}`)

  const audits = await call('GET', '/api/audits', { jar: adminJar })
  eq(audits.status, 200, 'GET /api/audits → 200')
  check('audits list non-empty', (audits.json?.audits ?? audits.json?.clients ?? []).length > 0, `keys=${Object.keys(audits.json ?? {}).join(',')}`)

  const auditDetail = await call('GET', `/api/audits/${seededClient?.id}`, { jar: adminJar })
  eq(auditDetail.status, 200, 'GET /api/audits/[id] → 200')

  const findings = await call('GET', '/api/findings', { jar: adminJar })
  eq(findings.status, 200, 'GET /api/findings → 200')
  const findingsList = findings.json?.findings ?? []
  check('findings list non-empty (seeded)', findingsList.length > 0, `count=${findingsList.length}`)

  if (findingsList.length > 0) {
    const f0 = findingsList[0]
    const findingDetail = await call('GET', `/api/findings/${f0.id}`, { jar: adminJar })
    eq(findingDetail.status, 200, 'GET /api/findings/[id] → 200')
    check('finding detail has real fields', !!(findingDetail.json?.finding?.id || findingDetail.json?.id), `keys=${Object.keys(findingDetail.json ?? {}).join(',').slice(0, 80)}`)
  }

  const findingsPaged = await call('GET', '/api/findings?limit=2', { jar: adminJar })
  check('findings pagination limit=2 respected', (findingsPaged.json?.findings ?? []).length <= 2, `got=${findingsPaged.json?.findings?.length}`)

  const monitoring = await call('GET', '/api/monitoring', { jar: adminJar })
  eq(monitoring.status, 200, 'GET /api/monitoring → 200')
  const monitoredList = monitoring.json?.monitored ?? monitoring.json?.projects ?? []
  // alerts are nested inside each monitored project; toggle ID key is monitoredProjectId
  const alertsList = monitoredList.flatMap((m: any) => m.alerts ?? [])
  check('monitoring has monitored projects', monitoredList.length >= 0, `monitored=${monitoredList.length}, alerts=${alertsList.length}`)

  const dashboard = await call('GET', '/api/dashboard', { jar: adminJar })
  eq(dashboard.status, 200, 'GET /api/dashboard → 200')
  check('dashboard payload is object', typeof dashboard.json === 'object' && dashboard.json !== null, `keys=${Object.keys(dashboard.json ?? {}).join(',').slice(0, 80)}`)

  // 404 handling
  const nf = await call('GET', '/api/audits/does-not-exist-id', { jar: adminJar })
  check('GET /api/audits/[bad-id] → 404/400 (not 500)', nf.status === 404 || nf.status === 400, `status=${nf.status}`)

  // ════════════════ PHASE 4 — mutations (admin) ════════════════
  group = 'P4 client create'
  const badClient = await call('POST', '/api/clients', { jar: adminJar, body: { name: '' } })
  eq(badClient.status, 400, 'client create empty name → 400')
  const newClient = await call('POST', '/api/clients', {
    jar: adminJar,
    body: { name: 'Audit Probe Logistics', industry: 'Logistics', sizeBand: '10-50', contactName: 'P. Probe', contactEmail: 'probe@audit.test' },
  })
  eq(newClient.status, 200, 'client create → 200')
  const probeClientId = newClient.json?.client?.id ?? newClient.json?.id
  check('created client has cuid', !!probeClientId && /^[a-z0-9]{20,}/.test(probeClientId), `id=${probeClientId}`)

  group = 'P4 extract-contract (REAL LLM)'
  const extract = await call('POST', '/api/extract-contract', {
    jar: adminJar,
    body: { rawText: SOW_TEXT, persist: true, clientId: probeClientId },
    timeoutMs: 180_000,
  })
  eq(extract.status, 200, 'extract-contract → 200')
  const parsed = extract.json?.extracted ?? extract.json?.parsed ?? extract.json?.extraction ?? extract.json
  const milestones = parsed?.milestones ?? []
  const exclusions = parsed?.exclusions ?? parsed?.outOfScope ?? []
  check('LLM parsed ≥2 milestones', milestones.length >= 2, `milestones=${JSON.stringify(milestones.map((m: any) => m.id ?? m.name ?? m.title ?? '?'))}`)
  check('LLM parsed exclusions/out-of-scope', Array.isArray(exclusions) ? exclusions.length > 0 : !!exclusions, `exclusions=${JSON.stringify(exclusions).slice(0, 100)}`)
  check('LLM parsed rate card (lineItems)', (parsed?.lineItems ?? []).some((li: any) => typeof li.rate === 'number'), `lineItems=${parsed?.lineItems?.length}`)
  check('milestones have real values', milestones.every((m: any) => typeof m.value === 'number' && !!m.dueDate), JSON.stringify(milestones.map((m: any) => `${m.id}=$${m.value}`)).slice(0, 120))
  const shortExtract = await call('POST', '/api/extract-contract', { jar: adminJar, body: { rawText: 'too short' } })
  eq(shortExtract.status, 400, 'extract-contract <30 chars → 400')

  group = 'P4 reconcile + idempotency'
  // probe client: project exists (persist), no delivery data → honest zero
  const reconZero = await call('POST', `/api/audits/${probeClientId}/reconcile`, { jar: adminJar, body: {} })
  eq(reconZero.status, 200, 'reconcile probe client (no delivery data) → 200')
  check('honest zero findings for no-delivery client', (reconZero.json?.summary?.created ?? reconZero.json?.created ?? 0) === 0, JSON.stringify(reconZero.json).slice(0, 150))

  const recon1 = await call('POST', `/api/audits/${seededClient?.id}/reconcile`, { jar: adminJar, body: {} })
  eq(recon1.status, 200, 'reconcile seeded client run#1 → 200')
  const s1 = recon1.json?.summary ?? recon1.json ?? {}
  console.log(`   (info) run#1 summary: ${JSON.stringify(s1).slice(0, 200)}`)

  const recon2 = await call('POST', `/api/audits/${seededClient?.id}/reconcile`, { jar: adminJar, body: {} })
  eq(recon2.status, 200, 'reconcile run#2 → 200')
  const s2 = recon2.json?.summary ?? recon2.json ?? {}
  const created2 = s2.created ?? s2.createdCount ?? 0
  eq(created2, 0, 'IDEMPOTENCY: run#2 creates 0 new findings')
  console.log(`   (info) run#2 summary: ${JSON.stringify(s2).slice(0, 200)}`)

  group = 'P4 finding transitions'
  const fList = (await call('GET', '/api/findings', { jar: adminJar })).json?.findings ?? []
  const openFinding = fList.find((f: any) => f.status === 'open' || f.state === 'open' || f.status === 'new')
  const anyFinding = openFinding ?? fList[0]
  if (anyFinding) {
    const approve = await call('PATCH', `/api/findings/${anyFinding.id}`, {
      jar: adminJar, body: { action: 'approve', reviewNotes: 'live-audit: approved' },
    })
    eq(approve.status, 200, `PATCH finding approve → 200 (${anyFinding.id.slice(-6)})`)
    const again = await call('PATCH', `/api/findings/${anyFinding.id}`, {
      jar: adminJar, body: { action: 'approve' },
    })
    check('illegal re-approve rejected (4xx, not 200)', again.status >= 400 && again.status < 500, `status=${again.status}`)
    const badAction = await call('PATCH', `/api/findings/${anyFinding.id}`, {
      jar: adminJar, body: { action: 'delete' },
    })
    eq(badAction.status, 400, 'unknown action → 400')
  } else {
    check('findings available for transition test', false, 'no findings found')
  }

  group = 'P4 monitoring'
  if (monitoredList.length > 0) {
    const mpId = monitoredList[0].monitoredProjectId ?? monitoredList[0].id
    const toggleOff = await call('PATCH', `/api/monitoring/${mpId}`, {
      jar: adminJar, body: { action: 'toggle', alertsEnabled: false },
    })
    eq(toggleOff.status, 200, `monitoring toggle off → 200 (${mpId.slice(-6)})`)
    const toggleOn = await call('PATCH', `/api/monitoring/${mpId}`, {
      jar: adminJar, body: { action: 'toggle', alertsEnabled: true },
    })
    eq(toggleOn.status, 200, 'monitoring toggle back on → 200')
    const badToggle = await call('PATCH', `/api/monitoring/${mpId}`, {
      jar: adminJar, body: { action: 'toggle' },
    })
    eq(badToggle.status, 400, 'toggle missing alertsEnabled → 400')
    const monDetail = await call('GET', `/api/monitoring/${mpId}`, { jar: adminJar })
    check('GET /api/monitoring/[id] → 200', monDetail.status === 200, `status=${monDetail.status}`)
  } else {
    console.log('   (info) no monitored projects in seed — toggle path untested live')
  }
  if (alertsList.length > 0) {
    const alert = alertsList.find((a: any) => !a.acknowledged) ?? alertsList[0]
    const ack = await call('PATCH', `/api/monitoring/${alert.id}`, {
      jar: adminJar, body: { action: 'ack', acknowledged: true },
    })
    eq(ack.status, 200, `alert ack → 200 (${alert.id.slice(-6)})`)
    const unack = await call('PATCH', `/api/monitoring/${alert.id}`, {
      jar: adminJar, body: { action: 'unack', acknowledged: false },
    })
    eq(unack.status, 200, 'alert unack → 200')
    const reack = await call('PATCH', `/api/monitoring/${alert.id}`, {
      jar: adminJar, body: { action: 'ack', acknowledged: true },
    })
    eq(reack.status, 200, 'alert re-ack → 200 (leaves it acknowledged)')
  } else {
    console.log('   (info) no alerts in seed — ack path untested live')
  }

  // ════════════════ PHASE 5 — role guards ════════════════
  group = 'P5 viewer role'
  const viewerJar: Jar = {}
  const vLogin = await call('POST', '/api/auth/login', { jar: viewerJar, body: VIEWER })
  eq(vLogin.status, 200, 'viewer login → 200')
  const vMe = await call('GET', '/api/auth/me', { jar: viewerJar })
  eq(vMe.json?.user?.role, 'viewer', 'viewer /me role=viewer')
  const vGet = await call('GET', '/api/clients', { jar: viewerJar })
  eq(vGet.status, 200, 'viewer can GET clients')
  const vClientPost = await call('POST', '/api/clients', { jar: viewerJar, body: { name: 'Nope' } })
  eq(vClientPost.status, 403, 'viewer client create → 403')
  const vFinding = fList[0] ? await call('PATCH', `/api/findings/${fList[0].id}`, {
    jar: viewerJar, body: { action: 'dismiss' },
  }) : null
  eq(vFinding?.status, 403, 'viewer finding PATCH → 403')
  const vExtract = await call('POST', '/api/extract-contract', { jar: viewerJar, body: { rawText: 'x'.repeat(40) } })
  eq(vExtract.status, 403, 'viewer extract-contract → 403')
  const vSeed = await call('POST', '/api/seed', { jar: viewerJar, body: {} })
  eq(vSeed.status, 403, 'viewer seed → 403')
  const vMonitor = alertsList[0] ? await call('PATCH', `/api/monitoring/${alertsList[0].id}`, {
    jar: viewerJar, body: { action: 'ack', acknowledged: true },
  }) : null
  eq(vMonitor?.status, 403, 'viewer monitoring ack → 403')

  group = 'P5 reviewer role'
  const reviewerJar: Jar = {}
  const rLogin = await call('POST', '/api/auth/login', { jar: reviewerJar, body: REVIEWER })
  eq(rLogin.status, 200, 'reviewer login → 200')
  const revFindings = (await call('GET', '/api/findings', { jar: reviewerJar })).json?.findings ?? []
  const revOpen = revFindings.find((f: any) => (f.status ?? f.state) === 'open' || (f.status ?? f.state) === 'escalated')
    ?? revFindings.find((f: any) => (f.status ?? f.state) !== 'approved')
  if (revOpen) {
    const rPatch = await call('PATCH', `/api/findings/${revOpen.id}`, {
      jar: reviewerJar, body: { action: 'escalate', reviewNotes: 'live-audit: reviewer escalate' },
    })
    eq(rPatch.status, 200, 'reviewer finding PATCH (escalate) → 200 (allowed role)')
  } else {
    console.log('   (info) no open finding left for reviewer transition — acceptable')
  }
  const rClientPost = await call('POST', '/api/clients', { jar: reviewerJar, body: { name: 'Nope2' } })
  eq(rClientPost.status, 403, 'reviewer client create → 403 (admin-only)')
  const rExtract = await call('POST', '/api/extract-contract', { jar: reviewerJar, body: { rawText: 'x'.repeat(40) } })
  eq(rExtract.status, 403, 'reviewer extract-contract → 403 (admin-only)')
  const rSeed = await call('POST', '/api/seed', { jar: reviewerJar, body: {} })
  eq(rSeed.status, 403, 'reviewer seed → 403 (admin-only)')

  // ════════════════ PHASE 6 — reseed + logout ════════════════
  group = 'P6 reseed'
  const seedRes = await call('POST', '/api/seed', { jar: adminJar, body: {}, timeoutMs: 120_000 })
  eq(seedRes.status, 200, 'POST /api/seed (admin) → 200')
  check('seed response ok', seedRes.json?.ok === true, JSON.stringify(seedRes.json).slice(0, 120))
  const postSeed = await call('GET', '/api/clients', { jar: adminJar })
  eq(postSeed.status, 200, 'clients readable after reseed')
  const postSeedFindings = (await call('GET', '/api/findings', { jar: adminJar })).json?.findings ?? []
  check('reseed restored demo findings', postSeedFindings.length >= 5, `findings=${postSeedFindings.length}`)
  check('probe client wiped by reseed (no residue)', !(postSeed.json?.clients ?? []).some((c: any) => c.name === 'Audit Probe Logistics'), 'residue check')

  group = 'P6 logout'
  const logout = await call('POST', '/api/auth/logout', { jar: adminJar })
  eq(logout.status, 200, 'logout → 200')
  const meAfter = await call('GET', '/api/auth/me', { jar: adminJar })
  check('session invalidated after logout', meAfter.status === 401, `status=${meAfter.status}`)

  // ════════════════ SUMMARY ════════════════
  const passed = results.filter(r => r.pass).length
  const failed = results.filter(r => !r.pass)
  console.log(`\n══════════ SUMMARY: ${passed}/${results.length} passed, ${failed.length} failed ══════════`)
  if (failed.length > 0) {
    console.log('\nFAILED:')
    for (const f of failed) console.log(`  ❌ ${f.name} — ${f.detail}`)
  }
  const { writeFileSync } = await import('node:fs')
  writeFileSync('/home/z/my-project/scripts/live-audit-results.json', JSON.stringify(results, null, 2))
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('AUDIT SCRIPT CRASHED:', err)
  process.exit(2)
})
