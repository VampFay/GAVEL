// One-off verification (audit v2 fix): prove the reconcile idempotency
// contract holds against the real seeded DB — every engine draft signature
// must match AT MOST one existing Finding row, and the seeded demo findings
// (which now carry engine signatures) must be found by signature, not title.
//
// Run: bun run scripts/verify-idempotency.ts
import { db } from '../src/lib/db'
import { runEngine } from '../src/lib/engine'

async function main() {
  const client = await db.client.findFirst({
    include: {
      contracts: {
        include: {
          lineItems: true,
          milestones: true,
          exclusions: true,
          changeOrders: true,
          invoices: { include: { lines: true } },
          projects: { include: { tickets: true, codeActivities: true } },
        },
      },
    },
  })
  if (!client) throw new Error('no client — run the seed first')
  const contract = client.contracts[0]
  if (!contract) throw new Error('no contract — run the seed first')
  const project = contract.projects[0]
  if (!project) throw new Error('no project — run the seed first')

  const output = runEngine(
    {
      contractId: contract.id,
      contractTitle: contract.title,
      currency: contract.currency,
      milestones: contract.milestones,
      lineItems: contract.lineItems,
      exclusions: contract.exclusions,
      changeOrders: contract.changeOrders,
      tickets: project.tickets,
      codeActivities: project.codeActivities,
      invoices: contract.invoices,
    },
    { now: new Date() }
  )

  const existing = await db.finding.findMany({
    where: { contractId: contract.id },
    select: { id: true, type: true, signature: true, title: true, status: true },
  })
  const bySignature = new Map(existing.filter(f => f.signature).map(f => [f.signature!, f]))

  let failures = 0
  const report: string[] = []

  report.push(`Engine emitted ${output.findings.length} drafts; DB has ${existing.length} findings.`)
  for (const draft of output.findings) {
    const matches = existing.filter(f => f.signature === draft.signature)
    if (matches.length > 1) {
      failures++
      report.push(`FAIL: signature "${draft.signature}" matches ${matches.length} rows`)
      continue
    }
    const match = bySignature.get(draft.signature)
    if (match) {
      report.push(
        `UPDATE (by signature): ${draft.type} → "${draft.title.slice(0, 48)}…" ` +
        `(${match.status === 'pending_review' ? 'will refresh evidence' : 'terminal — skipped'})`
      )
    } else {
      // Would the OLD (type,title) match have found it? Simulate the bug:
      const titleMatch = existing.find(f => f.type === draft.type && f.title === draft.title)
      report.push(
        `CREATE: ${draft.type} → "${draft.title.slice(0, 48)}…" ` +
        `(old title-match would have: ${titleMatch ? 'MATCHED — the pre-fix code updated a different finding' : 'created (same)'})`
      )
    }
  }

  // The seeded f1 (M4) must be an UPDATE-by-signature (its seeded title says
  // "completed", the engine says "delivered" — pre-fix this duplicated).
  const m4Draft = output.findings.find(f => f.signature.endsWith(':M4'))
  const f1 = existing.find(f => f.signature?.endsWith(':M4'))
  if (m4Draft && f1 && m4Draft.signature === f1.signature) {
    report.push('PASS: seeded M4 finding converges by signature despite title drift ' +
      `("${f1.title.slice(0, 40)}…" vs engine "${m4Draft.title.slice(0, 40)}…").`)
  } else {
    failures++
    report.push('FAIL: seeded M4 finding did not converge by signature')
  }

  console.log(report.join('\n'))
  console.log(failures === 0 ? '\nIDEMPOTENCY CONTRACT: OK' : `\nIDEMPOTENCY CONTRACT: ${failures} FAILURES`)
  await db.$disconnect()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
