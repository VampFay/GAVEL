import { NextRequest } from 'next/server'
import { ok, fail, notFound, withErrorHandler } from '@/lib/api'
import { getRequestId } from '@/lib/actor'
import { requireRole } from '@/lib/auth'
import { db } from '@/lib/db'
import { checkRateLimit, recordRateLimitHit } from '@/lib/rate-limit-store'
import { openSecret } from '@/lib/connectors/crypto'
import { GithubConfigSchema, JiraConfigSchema, type ConnectorKind } from '@/lib/connectors/types'
import { fetchGithubActivities } from '@/lib/connectors/github'
import { fetchJiraTickets } from '@/lib/connectors/jira'
import { commitTickets, commitCodeActivities } from '@/lib/ingest/commit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/connectors/[id]/sync — pull live evidence from GitHub / Jira.
 *
 * Body (optional): { dryRun?: boolean } — fetch + map + report without writing.
 *
 * Flow: load connector (tenant-scoped) → decrypt credentials → fetch from
 * the upstream API (bounded pages, timeouts, friendly error mapping) →
 * map to the normalized ticket/code-activity shapes → commit through the
 * SHARED ingestion layer (same idempotence as CSV uploads: tickets upsert
 * on (projectId, externalId), code activities dedupe on ref) → update the
 * connector's sync stamp → one audit-log entry.
 *
 * Auth: admin. Rate limit: 6 syncs / 5 min per user — every sync costs
 * upstream API budget, so it must not be hammerable.
 */

const SYNC_MAX = 6
const SYNC_WINDOW_MS = 5 * 60_000

export const POST = withErrorHandler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireRole(['admin'])
  const requestId = await getRequestId()
  const { id } = await ctx.params

  const limitKey = `connector-sync:user:${actor.id}`
  const limit = await checkRateLimit(limitKey, SYNC_MAX, SYNC_WINDOW_MS)
  if (!limit.allowed) {
    return Response.json(
      { ok: false, error: 'too many syncs — try again later' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    )
  }
  await recordRateLimitHit(limitKey, SYNC_WINDOW_MS)

  const body = await req.json().catch(() => ({})) as { dryRun?: boolean }
  const dryRun = body?.dryRun === true

  // Tenant-scoped load: a cross-tenant connector id is indistinguishable
  // from a missing one.
  const connector = await db.connectorSource.findUnique({
    where: { id },
    include: { project: { select: { id: true, tenantId: true, name: true } } },
  })
  if (!connector || !connector.project) return notFound('connector not found')
  const project = connector.project
  const tenantId = project.tenantId

  // ── Resolve config + credentials per kind ─────────────────────────
  const kind = connector.kind as ConnectorKind
  const credentials = connector.credentialsSealed
    ? (openSecret(connector.credentialsSealed) as Record<string, string>)
    : {}

  let fetched: { tickets?: Awaited<ReturnType<typeof fetchJiraTickets>>['tickets']; codeActivities?: Awaited<ReturnType<typeof fetchGithubActivities>>['activities']; apiCalls: number; truncated: boolean }

  if (kind === 'github') {
    const config = GithubConfigSchema.parse(JSON.parse(connector.config))
    if (!credentials.token && process.env.NODE_ENV === 'production') {
      // Allowed in dev (public repos), but warn loudly — the 60 req/h
      // unauthenticated budget is tiny.
      return fail('this GitHub connector has no stored token — re-save it with a personal access token', 409)
    }
    const r = await fetchGithubActivities(config, { token: credentials.token })
    fetched = { codeActivities: r.activities, apiCalls: r.apiCalls, truncated: r.truncated }
  } else if (kind === 'jira') {
    const config = JiraConfigSchema.parse(JSON.parse(connector.config))
    if (!credentials.apiToken || !credentials.email) {
      return fail('this Jira connector has no stored credentials — re-save it with email + API token', 409)
    }
    const r = await fetchJiraTickets(config, { apiToken: credentials.apiToken, email: credentials.email })
    fetched = { tickets: r.tickets, apiCalls: r.apiCalls, truncated: r.truncated }
  } else {
    return fail(`unknown connector kind: ${connector.kind}`, 500)
  }

  const counts = {
    tickets: fetched.tickets?.length ?? 0,
    codeActivities: fetched.codeActivities?.length ?? 0,
    apiCalls: fetched.apiCalls,
    truncated: fetched.truncated,
  }

  if (dryRun) {
    return ok({
      dryRun: true,
      kind,
      project: project.name,
      fetched: counts,
      preview: (fetched.tickets ?? fetched.codeActivities ?? []).slice(0, 5).map(r =>
        Object.fromEntries(
          Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])
        )
      ),
    })
  }

  // ── Commit through the shared ingestion layer ────────────────────
  const committed = await db.$transaction(async tx => {
    let ticketsResult: { created: number; updated: number } | null = null
    let activitiesResult: { created: number; duplicates: number } | null = null

    if (fetched.tickets && fetched.tickets.length > 0) {
      ticketsResult = await commitTickets(tx, project.id, tenantId, fetched.tickets)
    }
    if (fetched.codeActivities && fetched.codeActivities.length > 0) {
      activitiesResult = await commitCodeActivities(tx, project.id, tenantId, fetched.codeActivities)
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
        tenantId,
        actorId: actor.id,
        actor: actor.email,
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

  return ok({
    dryRun: false,
    kind,
    project: project.name,
    fetched: counts,
    committed: {
      ticketsCreated: committed.ticketsResult?.created ?? 0,
      ticketsUpdated: committed.ticketsResult?.updated ?? 0,
      activitiesCreated: committed.activitiesResult?.created ?? 0,
      duplicates: committed.activitiesResult?.duplicates ?? 0,
      hint: 'Run the reconciliation engine (POST /api/audits/{clientId}/reconcile) to evaluate the new evidence.',
    },
  })
})
