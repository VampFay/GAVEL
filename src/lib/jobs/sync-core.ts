// GAVEL — asynchronous connector sync pipeline (WP 1.2).
//
// POST /api/connectors/:id/sync previously executed the full pull + map +
// commit INLINE inside the Next.js API route — large repositories or Jira
// projects could exceed route timeouts. This module is the extracted core:
// one function, runConnectorSync(), callable from BOTH execution contexts:
//
//   * inline  — the API route calls it directly (dev / no-Redis fallback)
//   * queue   — a BullMQ worker calls it from scripts/run-worker.ts
//               (attempts + exponential backoff, survives route timeouts)
//
// The fetchers are injectable so unit tests never touch the network (same
// convention as src/lib/connectors/github.ts).

import { db } from '@/lib/db'
import { openSecret } from '@/lib/connectors/crypto'
import { GithubConfigSchema, JiraConfigSchema, type ConnectorKind } from '@/lib/connectors/types'
import { fetchGithubActivities, type FetchLike } from '@/lib/connectors/github'
import { fetchJiraTickets } from '@/lib/connectors/jira'
import { commitTickets, commitCodeActivities } from '@/lib/ingest/commit'

export interface SyncFetched {
  tickets?: Awaited<ReturnType<typeof fetchJiraTickets>>['tickets']
  codeActivities?: Awaited<ReturnType<typeof fetchGithubActivities>>['activities']
  apiCalls: number
  truncated: boolean
}

export interface SyncRunInput {
  /** Connector id (tenant-scoped load inside). */
  connectorId: string
  /** For audit attribution. */
  actorId: string
  actorEmail: string
  requestId?: string | null
  dryRun?: boolean
  /** Test seam: inject upstream fetchers (never hit the network in tests). */
  fetchImpl?: FetchLike
}

export interface SyncRunResult {
  kind: ConnectorKind
  projectName: string
  fetched: { tickets: number; codeActivities: number; apiCalls: number; truncated: boolean }
  committed?: {
    ticketsCreated: number
    ticketsUpdated: number
    activitiesCreated: number
    duplicates: number
  }
  preview?: Array<Record<string, unknown>>
}

/**
 * The full sync: tenant-scoped connector load → credential decryption →
 * upstream fetch (bounded pages, timeouts) → normalize → commit through
 * the shared ingestion layer (same idempotence as CSV uploads) → stamp
 * connector + audit log. Throws ConnectorError subclasses with friendly
 * messages + HTTP-ish status codes on upstream failures — the caller
 * (route or worker) decides how to surface them.
 */
export async function runConnectorSync(input: SyncRunInput): Promise<SyncRunResult> {
  const { connectorId, actorId, actorEmail, requestId, dryRun = false, fetchImpl } = input

  // Tenant-scoped load: a cross-tenant connector id is indistinguishable
  // from a missing one (app-layer where-injection + DB-level RLS).
  const connector = await db.connectorSource.findUnique({
    where: { id: connectorId },
    include: { project: { select: { id: true, tenantId: true, name: true } } },
  })
  if (!connector || !connector.project) {
    throw Object.assign(new Error('connector not found'), { status: 404 })
  }
  const project = connector.project

  const kind = connector.kind as ConnectorKind
  const credentials = connector.credentialsSealed
    ? (openSecret(connector.credentialsSealed) as Record<string, string>)
    : {}

  let fetched: SyncFetched

  if (kind === 'github') {
    const config = GithubConfigSchema.parse(JSON.parse(connector.config))
    if (!credentials.token && process.env.NODE_ENV === 'production') {
      throw Object.assign(
        new Error('this GitHub connector has no stored token — re-save it with a personal access token'),
        { status: 409 },
      )
    }
    const r = await fetchGithubActivities(config, { token: credentials.token }, fetchImpl)
    fetched = { codeActivities: r.activities, apiCalls: r.apiCalls, truncated: r.truncated }
  } else if (kind === 'jira') {
    const config = JiraConfigSchema.parse(JSON.parse(connector.config))
    if (!credentials.apiToken || !credentials.email) {
      throw Object.assign(
        new Error('this Jira connector has no stored credentials — re-save it with email + API token'),
        { status: 409 },
      )
    }
    const r = await fetchJiraTickets(config, { apiToken: credentials.apiToken, email: credentials.email }, fetchImpl)
    fetched = { tickets: r.tickets, apiCalls: r.apiCalls, truncated: r.truncated }
  } else {
    throw Object.assign(new Error(`unknown connector kind: ${connector.kind}`), { status: 500 })
  }

  const counts = {
    tickets: fetched.tickets?.length ?? 0,
    codeActivities: fetched.codeActivities?.length ?? 0,
    apiCalls: fetched.apiCalls,
    truncated: fetched.truncated,
  }

  if (dryRun) {
    return {
      kind,
      projectName: project.name,
      fetched: counts,
      preview: (fetched.tickets ?? fetched.codeActivities ?? []).slice(0, 5).map(r =>
        Object.fromEntries(
          Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])
        )
      ),
    }
  }

  // ── Commit through the shared ingestion layer ────────────────────
  const committed = await db.$transaction(async tx => {
    let ticketsResult: { created: number; updated: number } | null = null
    let activitiesResult: { created: number; duplicates: number } | null = null

    if (fetched.tickets && fetched.tickets.length > 0) {
      ticketsResult = await commitTickets(tx, project.id, project.tenantId, fetched.tickets)
    }
    if (fetched.codeActivities && fetched.codeActivities.length > 0) {
      activitiesResult = await commitCodeActivities(tx, project.id, project.tenantId, fetched.codeActivities)
    }

    const summary =
      (ticketsResult
        ? `${ticketsResult.created} tickets created, ${ticketsResult.updated} updated`
        : '') +
      (activitiesResult
        ? `${ticketsResult ? '; ' : ''}${activitiesResult.created} code activities added, ${activitiesResult.duplicates} duplicates skipped`
        : '') +
      (counts.truncated ? ' (upstream page cap reached — sync again for older records)' : '')

    await tx.connectorSource.update({
      where: { id: connector.id },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: 'ok',
        lastSyncSummary: summary || 'nothing new upstream',
      },
    })

    await tx.auditLog.create({
      data: {
        tenantId: project.tenantId,
        actorId,
        actor: actorEmail,
        action: 'connector_sync',
        entityType: 'connector',
        entityId: connector.id,
        detail: `${kind} sync — ${summary} (${counts.apiCalls} API calls)` +
          (requestId ? ` (request ${requestId})` : ''),
        requestId: requestId ?? undefined,
      },
    })

    return { ticketsResult, activitiesResult }
  })

  return {
    kind,
    projectName: project.name,
    fetched: counts,
    committed: {
      ticketsCreated: committed.ticketsResult?.created ?? 0,
      ticketsUpdated: committed.ticketsResult?.updated ?? 0,
      activitiesCreated: committed.activitiesResult?.created ?? 0,
      duplicates: committed.activitiesResult?.duplicates ?? 0,
    },
  }
}
