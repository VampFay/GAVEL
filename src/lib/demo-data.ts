// GAVEL — demo dataset creation (single source of truth).
//
// Extracted verbatim from scripts/seed.ts so the SAME data-definition code
// backs both paths:
//   - `bun run seed:dev` (scripts/seed.ts) — destructive: wipes all tables,
//     then calls seedDemoDataset(). CLI-only, explicit opt-in.
//   - src/lib/bootstrap.ts (sandbox self-heal) — NON-destructive: restores
//     demo users when missing, and the demo dataset only when the database
//     has zero clients (fresh / wiped DB). Guards: never in production,
//     opt-out via GAVEL_AUTO_SEED_DEMO=false.
//
// The data below MUST stay byte-identical across refactors — the engine's
// deterministic `signature` keys and scripts/verify-idempotency.ts depend
// on the exact line-item ids / exclusion clauses / PR refs emitted here.

import { db } from './db'
import { hashPassword } from './auth'

/** Demo accounts advertised on /login and in the README. Dev-only. */
export const DEMO_USERS = [
  { email: 'admin@gavel.demo', name: 'Demo Admin', role: 'admin', password: 'gavel-admin-demo' },
  { email: 'reviewer@gavel.demo', name: 'Demo Reviewer', role: 'reviewer', password: 'gavel-reviewer-demo' },
  { email: 'viewer@gavel.demo', name: 'Demo Viewer', role: 'viewer', password: 'gavel-viewer-demo' },
] as const

/**
 * Create any missing demo user. Idempotent and non-destructive: existing
 * rows (including passwords changed by a real admin) are left untouched.
 * Returns the emails actually created.
 */
export async function ensureDemoUsers(): Promise<string[]> {
  const created: string[] = []
  for (const u of DEMO_USERS) {
    const existing = await db.user.findUnique({
      where: { email: u.email },
      select: { id: true },
    })
    if (existing) continue
    await db.user.create({
      data: {
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash: await hashPassword(u.password),
      },
    })
    created.push(u.email)
  }
  return created
}

export interface SeedSummary {
  client: string
  contract: string
  project: string
  findings: number
  alerts: number
}

/**
 * Populate the full demo dataset (one audit client, contract, project,
 * tickets/commits, invoices, 5 findings with evidence, alerts).
 *
 * PRECONDITION: the target tables are empty (the CLI seed wipes first;
 * the bootstrap only calls this when client.count() === 0). Users are
 * created via ensureDemoUsers() so both entry points share one code path.
 */
export async function seedDemoDataset(): Promise<SeedSummary> {
  const usersCreated = await ensureDemoUsers()
  if (usersCreated.length > 0) {
    console.warn(`GAVEL demo-data: created ${usersCreated.length} missing demo user(s): ${usersCreated.join(', ')}`)
  }

  // ─────────────────────────── CLIENT ───────────────────────────
  const client = await db.client.create({
    data: {
      name: 'Aetherworks Technologies Pvt Ltd',
      industry: 'Custom software development',
      sizeBand: '10-50',
      contactName: 'Rahul Menon',
      contactEmail: 'rahul@aetherworks.co',
      logoUrl: '',
    },
  })

  // ─────────────────────── CONTRACT / SOW ────────────────────────
  const sowText = `STATEMENT OF WORK — Master Services Agreement
Client: Veridian Healthcare Solutions
Project: Patient Portal Redesign & Integration
Effective: 01 March 2025  |  End: 30 June 2025
Currency: INR

1. SCOPE
 1.1 Patient authentication & SSO integration (OAuth2 with hospital IdP)
 1.2 Appointment booking flow redesign (mobile + web)
 1.3 Pharmacy order history module
 1.4 Lab results viewer with PDF export
 1.5 Telemedicine video integration (third-party WebRTC SDK)
 1.6 Migration of legacy patient records (scope cap: 50,000 records)

2. RATE CARD
  Senior engineer: INR 4,500 / hour
  Frontend engineer: INR 2,800 / hour
  QA engineer: INR 2,200 / hour
  Project manager: INR 3,500 / hour

3. MILESTONES
  M1 — Auth & SSO complete: 31 March 2025 → INR 6,00,000
  M2 — Booking flow + pharmacy module: 30 April 2025 → INR 9,50,000
  M3 — Lab results viewer: 25 May 2025 → INR 5,50,000
  M4 — Telemedicine integration: 15 June 2025 → INR 7,00,000
  M5 — Data migration + UAT: 30 June 2025 → INR 4,00,000

4. CHANGE ORDERS
  Any scope addition beyond the above requires a signed change order
  before work commences. Verbal or email-only instructions do NOT
  constitute authorization.

5. EXCLUSIONS
  5.1 Backend hospital EMR customization is NOT in scope.
  5.2 Infrastructure / DevOps work billed separately.
  5.3 Content migration beyond record count above is out of scope.`

  const contract = await db.contract.create({
    data: {
      clientId: client.id,
      title: 'Patient Portal Redesign & Integration — SOW',
      effectiveDate: new Date('2025-03-01'),
      endDate: new Date('2025-06-30'),
      currency: 'INR',
      totalValue: 3200000,
      rawText: sowText,
      status: 'active',
    },
  })

  // ─────────────────────────── LINE ITEMS ────────────────────────
  const lineItems = [
    { description: 'Patient authentication & SSO integration (OAuth2)', rate: 4500, rateUnit: 'hour', quantity: 90, milestone: 'M1', deliveryDate: new Date('2025-03-31') },
    { description: 'Appointment booking flow redesign', rate: 2800, rateUnit: 'hour', quantity: 140, milestone: 'M2', deliveryDate: new Date('2025-04-30') },
    { description: 'Pharmacy order history module', rate: 2800, rateUnit: 'hour', quantity: 80, milestone: 'M2', deliveryDate: new Date('2025-04-30') },
    { description: 'Lab results viewer with PDF export', rate: 2800, rateUnit: 'hour', quantity: 110, milestone: 'M3', deliveryDate: new Date('2025-05-25') },
    { description: 'Telemedicine video integration', rate: 4500, rateUnit: 'hour', quantity: 100, milestone: 'M4', deliveryDate: new Date('2025-06-15') },
    { description: 'Legacy patient records migration (cap 50,000 records)', rate: 2200, rateUnit: 'hour', quantity: 120, milestone: 'M5', deliveryDate: new Date('2025-06-30') },
  ]
  // Keep the created rows — the seeded findings below reference their ids
  // in the engine's deterministic `signature` keys, so the FIRST reconcile
  // run updates these rows in place instead of duplicating them.
  const lineItemRows: { id: string; description: string }[] = []
  for (const li of lineItems) {
    const row = await db.lineItem.create({ data: { contractId: contract.id, ...li } })
    lineItemRows.push({ id: row.id, description: row.description })
  }

  // ─────────────────────── PROJECT & DELIVERY ───────────────────
  const project = await db.project.create({
    data: {
      clientId: client.id,
      contractId: contract.id,
      name: 'Veridian Patient Portal',
      status: 'active',
      startDate: new Date('2025-03-01'),
      endDate: new Date('2025-06-30'),
    },
  })

  // Tickets (Jira-like) — uses renamed externalCreated/externalUpdated
  // (the previous `created`/`updated` collided with Prisma's own timestamps).
  const tickets = [
    { externalId: 'ENG-101', title: 'OAuth2 IdP integration scaffold', type: 'story', status: 'done', assignee: 'Aisha K.', externalCreated: new Date('2025-03-02'), externalUpdated: new Date('2025-03-20') },
    { externalId: 'ENG-104', title: 'Hospital IdP token refresh flow', type: 'story', status: 'done', assignee: 'Aisha K.', externalCreated: new Date('2025-03-05'), externalUpdated: new Date('2025-03-25') },
    { externalId: 'ENG-110', title: 'Appointment booking UI — calendar grid', type: 'story', status: 'done', assignee: 'Dev R.', externalCreated: new Date('2025-03-15'), externalUpdated: new Date('2025-04-18') },
    { externalId: 'ENG-118', title: 'Pharmacy order history API', type: 'story', status: 'done', assignee: 'Dev R.', externalCreated: new Date('2025-03-22'), externalUpdated: new Date('2025-04-26') },
    { externalId: 'ENG-122', title: 'Lab results PDF renderer', type: 'story', status: 'done', assignee: 'Meera S.', externalCreated: new Date('2025-04-12'), externalUpdated: new Date('2025-05-22') },
    { externalId: 'ENG-131', title: 'Telemedicine WebRTC SDK integration', type: 'story', status: 'done', assignee: 'Aisha K.', externalCreated: new Date('2025-05-02'), externalUpdated: new Date('2025-06-14') },
    { externalId: 'ENG-140', title: 'Patient push notification preferences', type: 'story', status: 'done', assignee: 'Dev R.', externalCreated: new Date('2025-05-10'), externalUpdated: new Date('2025-06-05') },
    { externalId: 'ENG-145', title: 'Audit log streaming to Splunk', type: 'task', status: 'done', assignee: 'Meera S.', externalCreated: new Date('2025-05-18'), externalUpdated: new Date('2025-06-08') },
    { externalId: 'ENG-149', title: 'Backend EMR customization — prescription endpoint', type: 'task', status: 'done', assignee: 'Aisha K.', externalCreated: new Date('2025-05-22'), externalUpdated: new Date('2025-06-12') },
    { externalId: 'ENG-152', title: 'Kubernetes ingress hardening', type: 'task', status: 'done', assignee: 'Dev R.', externalCreated: new Date('2025-05-28'), externalUpdated: new Date('2025-06-10') },
    { externalId: 'ENG-155', title: 'Legacy record migration beyond 50k cap', type: 'task', status: 'done', assignee: 'Meera S.', externalCreated: new Date('2025-06-01'), externalUpdated: new Date('2025-06-25') },
    { externalId: 'ENG-158', title: 'WCAG 2.1 AA accessibility audit & remediation', type: 'task', status: 'done', assignee: 'Dev R.', externalCreated: new Date('2025-06-05'), externalUpdated: new Date('2025-06-22') },
  ]
  for (const t of tickets) {
    await db.ticket.create({ data: { projectId: project.id, ...t, description: '' } })
  }

  // Code activity (GitHub-like)
  const commits = [
    { type: 'pr', ref: '#214', title: 'OAuth2 IdP integration — closes ENG-101', author: 'aisha-k', timestamp: new Date('2025-03-22T10:14:00Z'), additions: 1840, deletions: 120, filesChanged: 23, url: 'https://github.com/aetherworks/veridian-portal/pull/214' },
    { type: 'pr', ref: '#231', title: 'Appointment booking calendar grid — closes ENG-110', author: 'dev-r', timestamp: new Date('2025-04-18T16:42:00Z'), additions: 2740, deletions: 320, filesChanged: 31, url: 'https://github.com/aetherworks/veridian-portal/pull/231' },
    { type: 'pr', ref: '#245', title: 'Pharmacy history API — closes ENG-118', author: 'dev-r', timestamp: new Date('2025-04-26T09:21:00Z'), additions: 1560, deletions: 80, filesChanged: 18, url: 'https://github.com/aetherworks/veridian-portal/pull/245' },
    { type: 'pr', ref: '#261', title: 'Lab results PDF renderer — closes ENG-122', author: 'meera-s', timestamp: new Date('2025-05-22T14:55:00Z'), additions: 1920, deletions: 240, filesChanged: 25, url: 'https://github.com/aetherworks/veridian-portal/pull/261' },
    { type: 'pr', ref: '#284', title: 'Telemedicine WebRTC integration — closes ENG-131', author: 'aisha-k', timestamp: new Date('2025-06-14T11:08:00Z'), additions: 3100, deletions: 410, filesChanged: 42, url: 'https://github.com/aetherworks/veridian-portal/pull/284' },
    { type: 'pr', ref: '#298', title: 'Push notification preferences — closes ENG-140', author: 'dev-r', timestamp: new Date('2025-06-05T15:33:00Z'), additions: 980, deletions: 60, filesChanged: 12, url: 'https://github.com/aetherworks/veridian-portal/pull/298' },
    { type: 'pr', ref: '#311', title: 'Audit log streaming to Splunk — closes ENG-145', author: 'meera-s', timestamp: new Date('2025-06-08T18:11:00Z'), additions: 720, deletions: 40, filesChanged: 9, url: 'https://github.com/aetherworks/veridian-portal/pull/311' },
    { type: 'pr', ref: '#319', title: 'EMR prescription endpoint — closes ENG-149 (out of baseline scope)', author: 'aisha-k', timestamp: new Date('2025-06-12T09:50:00Z'), additions: 1340, deletions: 90, filesChanged: 16, url: 'https://github.com/aetherworks/veridian-portal/pull/319' },
    { type: 'pr', ref: '#322', title: 'K8s ingress hardening — closes ENG-152 (infra/DevOps — excluded per SOW §5.2)', author: 'dev-r', timestamp: new Date('2025-06-10T13:24:00Z'), additions: 460, deletions: 220, filesChanged: 8, url: 'https://github.com/aetherworks/veridian-portal/pull/322' },
    { type: 'pr', ref: '#341', title: 'Legacy record migration — closes ENG-155 (records 50,001–87,000)', author: 'meera-s', timestamp: new Date('2025-06-25T16:40:00Z'), additions: 1820, deletions: 50, filesChanged: 21, url: 'https://github.com/aetherworks/veridian-portal/pull/341' },
    { type: 'pr', ref: '#349', title: 'WCAG 2.1 AA remediation pass — closes ENG-158', author: 'dev-r', timestamp: new Date('2025-06-22T12:00:00Z'), additions: 940, deletions: 380, filesChanged: 28, url: 'https://github.com/aetherworks/veridian-portal/pull/349' },
  ]
  for (const c of commits) {
    await db.codeActivity.create({ data: { projectId: project.id, ...c } })
  }

  // ─────────────────────── MILESTONES & EXCLUSIONS ─────────────────
  // Persisted as proper rows now (previously only in rawText). This lets
  // the §9.3 rules engine actually query milestones/exclusions instead
  // of regexing the SOW every time.
  const milestoneRows = [
    { externalId: 'M1', description: 'Auth & SSO complete', dueDate: new Date('2025-03-31'), value: 600000, currency: 'INR' },
    { externalId: 'M2', description: 'Booking flow + pharmacy module', dueDate: new Date('2025-04-30'), value: 950000, currency: 'INR' },
    { externalId: 'M3', description: 'Lab results viewer', dueDate: new Date('2025-05-25'), value: 550000, currency: 'INR' },
    { externalId: 'M4', description: 'Telemedicine integration', dueDate: new Date('2025-06-15'), value: 700000, currency: 'INR' },
    { externalId: 'M5', description: 'Data migration + UAT', dueDate: new Date('2025-06-30'), value: 400000, currency: 'INR' },
  ]
  for (const m of milestoneRows) {
    await db.milestone.create({ data: { contractId: contract.id, ...m } })
  }
  const exclusionRows = [
    { clause: '5.1', description: 'Backend hospital EMR customization is NOT in scope.' },
    { clause: '5.2', description: 'Infrastructure / DevOps work billed separately.' },
    { clause: '5.3', description: 'Content migration beyond record count above is out of scope.' },
  ]
  // Keep the created rows — seeded findings reference their ids in engine
  // signature keys (see above).
  const exclusionRowsCreated: { id: string; clause: string | null }[] = []
  for (const e of exclusionRows) {
    const row = await db.exclusion.create({ data: { contractId: contract.id, ...e } })
    exclusionRowsCreated.push({ id: row.id, clause: row.clause })
  }

  // ─────────────────────────── INVOICES ──────────────────────────
  const invoice1 = await db.invoice.create({
    data: {
      clientId: client.id,
      contractId: contract.id,
      number: 'INV-2025-014',
      issueDate: new Date('2025-04-02'),
      dueDate: new Date('2025-04-30'),
      status: 'paid',
      total: 600000,
      currency: 'INR',
    },
  })
  await db.invoiceLine.create({ data: { invoiceId: invoice1.id, description: 'M1 — Auth & SSO complete', amount: 600000, periodStart: new Date('2025-03-01'), periodEnd: new Date('2025-03-31') } })

  const invoice2 = await db.invoice.create({
    data: {
      clientId: client.id,
      contractId: contract.id,
      number: 'INV-2025-028',
      issueDate: new Date('2025-05-02'),
      dueDate: new Date('2025-05-31'),
      status: 'paid',
      total: 950000,
      currency: 'INR',
    },
  })
  await db.invoiceLine.create({ data: { invoiceId: invoice2.id, description: 'M2 — Booking flow + pharmacy module', amount: 950000, periodStart: new Date('2025-04-01'), periodEnd: new Date('2025-04-30') } })

  const invoice3 = await db.invoice.create({
    data: {
      clientId: client.id,
      contractId: contract.id,
      number: 'INV-2025-041',
      issueDate: new Date('2025-06-01'),
      dueDate: new Date('2025-06-30'),
      status: 'issued',
      total: 550000,
      currency: 'INR',
    },
  })
  await db.invoiceLine.create({ data: { invoiceId: invoice3.id, description: 'M3 — Lab results viewer', amount: 550000, periodStart: new Date('2025-05-01'), periodEnd: new Date('2025-05-31') } })

  // M4 (Telemedicine) & M5 (Migration + UAT) NOT yet invoiced → triggers missed_milestone finding later

  // ─────────────────────────── FINDINGS ──────────────────────────

  // Engine signature keys — these match what runEngine() produces for the
  // same data, so a reconcile run UPDATES these seeded rows (idempotent
  // upsert by signature) instead of creating duplicates. F5 below gets NO
  // signature: it's a hand-typed demo finding the engine would never emit,
  // and null signature = "not engine-managed".
  const migrationLi = lineItemRows.find(li => li.description.includes('Legacy patient records migration'))
  const emrExclusion = exclusionRowsCreated.find(e => e.clause === '5.1')
  const infraExclusion = exclusionRowsCreated.find(e => e.clause === '5.2')

  // F1 — Missed milestone (M4 telemedicine completed but no invoice within 30 days)
  const f1 = await db.finding.create({
    data: {
      contractId: contract.id,
      projectId: project.id,
      type: 'missed_milestone',
      signature: `missed_milestone:${contract.id}:M4`,
      title: 'M4 — Telemedicine integration completed, no invoice issued',
      summary: 'PR #284 merged on 14 June 2025 closes milestone M4. Per SOW §3, M4 triggers INR 7,00,000. As of today, no invoice line for M4 exists in the billing record.',
      impactAmount: 700000,
      confidence: 'HIGH',
      confidenceScore: 0.93,
      assessment: 'billable',
      recommendedAction: 'approve',
      contractClause: 'SOW §3 Milestone M4 — Telemedicine integration: 15 June 2025 → INR 7,00,000',
      billingState: 'no invoice line within 30 days of milestone completion',
      status: 'pending_review',
    },
  })
  await db.findingEvidence.createMany({ data: [
    { findingId: f1.id, evidenceType: 'contract_clause', source: 'sow', refId: 'M4', title: 'SOW §3 — Milestone M4', detail: 'Telemedicine integration due 15 June 2025 → INR 7,00,000', timestamp: new Date('2025-03-01'), weight: 0.4 },
    { findingId: f1.id, evidenceType: 'delivery_record', source: 'github', refId: '#284', title: 'PR #284 — Telemedicine WebRTC integration', detail: 'Merged 14 June 2025 by aisha-k · 3,100 additions / 42 files · closes ENG-131', timestamp: new Date('2025-06-14T11:08:00Z'), weight: 0.35 },
    { findingId: f1.id, evidenceType: 'delivery_record', source: 'jira', refId: 'ENG-131', title: 'ENG-131 — Telemedicine WebRTC SDK integration', detail: 'Status: done · Assignee: Aisha K. · Updated 14 June 2025', timestamp: new Date('2025-06-14T11:08:00Z'), weight: 0.1 },
    { findingId: f1.id, evidenceType: 'billing_record', source: 'invoice', refId: 'INV-2025-041', title: 'INV-2025-041 — latest invoice', detail: 'Issued 01 June 2025 · only contains M3 line · no M4 line present', timestamp: new Date('2025-06-01'), weight: 0.08 },
  ]})

  // F2 — Unbilled overage on legacy migration (cap was 50k; 87k actually migrated)
  const f2 = await db.finding.create({
    data: {
      contractId: contract.id,
      projectId: project.id,
      type: 'unbilled_overage',
      signature: migrationLi ? `unbilled_overage:${contract.id}:${migrationLi.id}:#341` : null,
      title: 'Legacy patient-record migration exceeded contracted cap by 37,000 records',
      summary: 'SOW §1.6 caps migration at 50,000 records. PR #341 explicitly migrates records 50,001–87,000. No change order exists. Effort can be valued against §2 rate card (QA engineer INR 2,200/hr).',
      impactAmount: 184000,
      confidence: 'MEDIUM',
      confidenceScore: 0.71,
      assessment: 'ambiguous',
      recommendedAction: 'draft_change_order',
      contractClause: 'SOW §1.6 — Migration cap: 50,000 records; §2 rate card QA INR 2,200/hr',
      billingState: 'no invoice line for overage; M5 base cap covered by planned invoice',
      status: 'pending_review',
    },
  })
  await db.findingEvidence.createMany({ data: [
    { findingId: f2.id, evidenceType: 'contract_clause', source: 'sow', refId: '§1.6', title: 'SOW §1.6 — Migration cap', detail: 'Cap 50,000 records. Beyond cap requires change order.', timestamp: new Date('2025-03-01'), weight: 0.35 },
    { findingId: f2.id, evidenceType: 'delivery_record', source: 'github', refId: '#341', title: 'PR #341 — Legacy record migration', detail: 'Merged 25 June 2025 · description: "records 50,001–87,000" · 1,820 additions', timestamp: new Date('2025-06-25T16:40:00Z'), weight: 0.4 },
    { findingId: f2.id, evidenceType: 'delivery_record', source: 'jira', refId: 'ENG-155', title: 'ENG-155 — Legacy record migration beyond 50k cap', detail: 'Status: done · Updated 25 June 2025', timestamp: new Date('2025-06-25T16:40:00Z'), weight: 0.15 },
    { findingId: f2.id, evidenceType: 'billing_record', source: 'change_order', refId: 'none', title: 'No change order found', detail: 'No signed change order covering records beyond the 50,000 cap.', timestamp: new Date('2025-06-25'), weight: 0.1 },
  ]})

  // F3 — Scope expansion: EMR prescription endpoint (excluded per SOW §5.1)
  const f3 = await db.finding.create({
    data: {
      contractId: contract.id,
      projectId: project.id,
      type: 'scope_expansion',
      signature: emrExclusion ? `scope_expansion:${contract.id}:${emrExclusion.id}:#319` : null,
      title: 'EMR prescription endpoint built despite §5.1 exclusion',
      summary: 'SOW §5.1 explicitly excludes backend hospital EMR customization. ENG-149 ("EMR prescription endpoint") was completed (PR #319 merged 12 June). Work was delivered but is outside baseline scope — client authorized verbally per ticket comments, no signed change order.',
      impactAmount: 96000,
      confidence: 'MEDIUM',
      confidenceScore: 0.68,
      assessment: 'ambiguous',
      recommendedAction: 'draft_change_order',
      contractClause: 'SOW §5.1 — Backend hospital EMR customization NOT in scope; §4 — change order required before work',
      billingState: 'not billed; risk: delivered scope not recoverable without signed change order',
      status: 'pending_review',
    },
  })
  await db.findingEvidence.createMany({ data: [
    { findingId: f3.id, evidenceType: 'contract_clause', source: 'sow', refId: '§5.1', title: 'SOW §5.1 — EMR customization excluded', detail: 'Backend hospital EMR customization is NOT in scope.', timestamp: new Date('2025-03-01'), weight: 0.35 },
    { findingId: f3.id, evidenceType: 'delivery_record', source: 'github', refId: '#319', title: 'PR #319 — EMR prescription endpoint', detail: 'Merged 12 June 2025 · 1,340 additions · closes ENG-149 · PR title flagged "(out of baseline scope)"', timestamp: new Date('2025-06-12T09:50:00Z'), weight: 0.4 },
    { findingId: f3.id, evidenceType: 'delivery_record', source: 'jira', refId: 'ENG-149', title: 'ENG-149 — EMR prescription endpoint', detail: 'Status: done · comment thread suggests verbal client authorization', timestamp: new Date('2025-06-12T09:50:00Z'), weight: 0.15 },
    { findingId: f3.id, evidenceType: 'billing_record', source: 'change_order', refId: 'none', title: 'No signed change order', detail: 'Verbal/email authorization does NOT meet §4 requirement.', timestamp: new Date('2025-06-12'), weight: 0.1 },
  ]})

  // F4 — Scope expansion: K8s ingress hardening (excluded per SOW §5.2)
  const f4 = await db.finding.create({
    data: {
      contractId: contract.id,
      projectId: project.id,
      type: 'scope_expansion',
      signature: infraExclusion ? `scope_expansion:${contract.id}:${infraExclusion.id}:#322` : null,
      title: 'K8s ingress hardening delivered (excluded under §5.2)',
      summary: 'SOW §5.2 excludes infrastructure/DevOps work. ENG-152 / PR #322 completed K8s ingress hardening. Recommend: bill as separate infra engagement per rate card.',
      impactAmount: 38000,
      confidence: 'HIGH',
      confidenceScore: 0.86,
      assessment: 'billable',
      recommendedAction: 'approve',
      contractClause: 'SOW §5.2 — Infrastructure / DevOps work billed separately',
      billingState: 'not invoiced; eligible for separate infra invoice',
      status: 'pending_review',
    },
  })
  await db.findingEvidence.createMany({ data: [
    { findingId: f4.id, evidenceType: 'contract_clause', source: 'sow', refId: '§5.2', title: 'SOW §5.2 — Infra/DevOps billed separately', detail: 'Infrastructure / DevOps work billed separately.', timestamp: new Date('2025-03-01'), weight: 0.4 },
    { findingId: f4.id, evidenceType: 'delivery_record', source: 'github', refId: '#322', title: 'PR #322 — K8s ingress hardening', detail: 'Merged 10 June 2025 · PR title flags excluded category · 460 additions', timestamp: new Date('2025-06-10T13:24:00Z'), weight: 0.4 },
    { findingId: f4.id, evidenceType: 'delivery_record', source: 'jira', refId: 'ENG-152', title: 'ENG-152 — K8s ingress hardening', detail: 'Status: done', timestamp: new Date('2025-06-10T13:24:00Z'), weight: 0.1 },
    { findingId: f4.id, evidenceType: 'billing_record', source: 'invoice', refId: 'none', title: 'No infra invoice found', detail: 'Should be invoiced as separate DevOps line per rate card.', timestamp: new Date('2025-06-10'), weight: 0.1 },
  ]})

  // F5 — Already covered (false positive example to demonstrate review queue dismission).
  // No signature — the engine would never emit this finding (null = manual).
  const f5 = await db.finding.create({
    data: {
      contractId: contract.id,
      projectId: project.id,
      type: 'unbilled_overage',
      title: 'Telemedicine integration — effort vs cap (rule-flagged, low confidence)',
      summary: 'Rule flagged telemedicine effort (PR #284: 3,100 additions) as exceeding typical scope of M4. On review, the SOW does not bound M4 by lines-of-code; effort is consistent with the rate-card allocation. Recommendation: dismiss.',
      impactAmount: 0,
      confidence: 'LOW',
      confidenceScore: 0.34,
      assessment: 'already_covered',
      recommendedAction: 'dismiss',
      contractClause: 'SOW §3 M4 — no line-count constraint on this milestone',
      billingState: 'M4 milestone correctly invoiced under planned milestone billing',
      status: 'pending_review',
    },
  })
  await db.findingEvidence.createMany({ data: [
    { findingId: f5.id, evidenceType: 'contract_clause', source: 'sow', refId: '§3 M4', title: 'SOW §3 M4 — Telemedicine', detail: 'Milestone value INR 7,00,000 — no line-count cap', timestamp: new Date('2025-03-01'), weight: 0.2 },
    { findingId: f5.id, evidenceType: 'delivery_record', source: 'github', refId: '#284', title: 'PR #284 — Telemedicine integration', detail: '3,100 additions — within typical scope for the milestone value', timestamp: new Date('2025-06-14T11:08:00Z'), weight: 0.05 },
    { findingId: f5.id, evidenceType: 'contradicting', source: 'invoice', refId: 'M4', title: 'M4 covered by milestone billing', detail: 'M4 milestone billing structure does not require per-line reconciliation', timestamp: new Date('2025-06-14'), weight: 0.05 },
  ]})

  // ─────────────── MONITORED PROJECT & ALERTS (Phase 3) ─────────
  const monitored = await db.monitoredProject.create({
    data: {
      projectId: project.id,
      alertsEnabled: true,
      driftBaseline: 1.0,
    },
  })
  const alerts = [
    { severity: 'critical', category: 'milestone_gap', message: 'M4 (Telemedicine, INR 7,00,000) delivered 12+ weeks ago, still no invoice line. Drift: 2.3σ.', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 6) },
    { severity: 'warning', category: 'scope_creep', message: 'New Jira epic ENG-160 "Patient consent revocation flow" has no matching change order in baseline.', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 18) },
    { severity: 'info', category: 'billing_drift', message: 'Weekly delivery-to-billing ratio: 1.41 (above 1.20 drift threshold for second consecutive week).', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 30) },
    { severity: 'warning', category: 'rate_risk', message: 'Senior-engineer hours booked against ENG-149 exceed 24h — rate card authorization required.', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48) },
  ]
  for (const a of alerts) {
    await db.alert.create({ data: { monitoredProjectId: monitored.id, ...a } })
  }

  // Audit log
  await db.auditLog.create({ data: { actor: 'system', action: 'seed', entityType: 'client', entityId: client.id, detail: 'Demo data seeded for Aetherworks — Veridian Patient Portal audit' } })

  return {
    client: client.id,
    contract: contract.id,
    project: project.id,
    findings: 5,
    alerts: alerts.length,
  }
}
