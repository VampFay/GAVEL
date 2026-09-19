// GAVEL — shared ingestion commit layer.
//
// The SINGLE write path for delivery evidence, used by BOTH producers:
//   - POST /api/ingest (CSV/JSON upload)
//   - POST /api/connectors/[id]/sync (live GitHub/Jira pull)
//
// Extracted verbatim from the ingest route so the idempotence semantics
// can never drift between the two:
//   - tickets:   upsert keyed on (projectId, externalId) — re-sync
//                UPDATES fields instead of duplicating
//   - commits:   deduped by ref (commit sha / PR number) within the
//                project — already-known refs are skipped, counted
//
// tenantId is stamped EXPLICITLY on every write: interactive-transaction
// callbacks receive the base transaction client, so relying on the
// request-context extension inside them is not guaranteed across Prisma
// versions. Explicit beats implicit for the one column that must never
// be wrong.

import type { Prisma } from '@prisma/client'
import type { MappedCodeActivity, MappedTicket } from './mappers'

type Tx = Prisma.TransactionClient

export interface TicketCommitResult {
  created: number
  updated: number
}

export interface ActivityCommitResult {
  created: number
  duplicates: number
}

/** Upsert tickets by (projectId, externalId). */
export async function commitTickets(
  tx: Tx,
  projectId: string,
  tenantId: string,
  tickets: MappedTicket[]
): Promise<TicketCommitResult> {
  const existing = await tx.ticket.findMany({
    where: { projectId },
    select: { externalId: true },
  })
  const known = new Set(existing.map(t => t.externalId))

  let created = 0
  let updated = 0
  for (const t of tickets) {
    const data = {
      tenantId,
      projectId,
      externalId: t.externalId,
      title: t.title,
      type: t.type,
      status: t.status,
      assignee: t.assignee,
      externalCreated: t.externalCreated,
      externalUpdated: t.externalUpdated,
      description: t.description,
    }
    if (known.has(t.externalId)) {
      await tx.ticket.update({
        where: { projectId_externalId: { projectId, externalId: t.externalId } },
        data,
      })
      updated++
    } else {
      await tx.ticket.create({ data })
      known.add(t.externalId)
      created++
    }
  }
  return { created, updated }
}

/** Insert code activities, deduping on ref within the project. */
export async function commitCodeActivities(
  tx: Tx,
  projectId: string,
  tenantId: string,
  activities: MappedCodeActivity[]
): Promise<ActivityCommitResult> {
  const existing = await tx.codeActivity.findMany({
    where: { projectId },
    select: { ref: true },
  })
  const known = new Set(existing.map(a => a.ref))
  const seen = new Set<string>()

  const fresh: Array<{
    tenantId: string
    projectId: string
    type: string
    ref: string
    title: string
    author: string
    timestamp: Date
    additions: number | null
    deletions: number | null
    filesChanged: number | null
    url: string | null
  }> = []
  let duplicates = 0
  for (const a of activities) {
    if (known.has(a.ref) || seen.has(a.ref)) {
      duplicates++
      continue
    }
    seen.add(a.ref)
    fresh.push({
      tenantId,
      projectId,
      type: a.type,
      ref: a.ref,
      title: a.title,
      author: a.author,
      timestamp: a.timestamp,
      additions: a.additions,
      deletions: a.deletions,
      filesChanged: a.filesChanged,
      url: a.url,
    })
  }
  if (fresh.length > 0) {
    await tx.codeActivity.createMany({ data: fresh })
  }
  return { created: fresh.length, duplicates }
}
