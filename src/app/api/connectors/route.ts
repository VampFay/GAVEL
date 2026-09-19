import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { ok, fail, notFound, invalidRequest, withErrorHandler } from '@/lib/api'
import { getRequestId } from '@/lib/actor'
import { requireRole } from '@/lib/auth'
import { db } from '@/lib/db'
import { currentTenantId } from '@/lib/tenant-context'
import { sealSecret } from '@/lib/connectors/crypto'
import { GithubConfigSchema, JiraConfigSchema, CONNECTOR_KINDS, type ConnectorKind } from '@/lib/connectors/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Connector configuration endpoints (production blocker #4).
 *
 * GET /api/connectors?projectId=<id> | ?clientId=<id> — list connectors
 *   (configs sanitized: never any credential material).
 *
 * PUT /api/connectors — create or update a project's connector.
 *   Body: { projectId? , clientId?, kind: 'github'|'jira', config: {...}, credentials?: {...} }
 *   - resolve the target project the same way /api/ingest does:
 *     projectId directly, or clientId → contract[0] → project[0]
 *     (get-or-create as the ingest safety net does)
 *   - config is validated per-kind (zod) BEFORE persistence
 *   - credentials are sealed with AES-256-GCM (src/lib/connectors/crypto.ts)
 *     and stored as an opaque blob; omitting `credentials` on update keeps
 *     the previously sealed blob (so config tweaks don't require re-entry)
 *   - one connector per (project, kind) — upsert semantics
 *
 * DELETE /api/connectors?id=<id> — remove a connector and its sealed blob.
 *
 * Auth: admin (same privilege as ingestion — connectors WRITE evidence).
 */

function validateConfig(kind: ConnectorKind, config: unknown): Record<string, unknown> {
  const schema = kind === 'github' ? GithubConfigSchema : JiraConfigSchema
  const parsed = schema.safeParse(config)
  if (!parsed.success) {
    throw Object.assign(new Error(`invalid ${kind} config: ${parsed.error.issues[0]?.message ?? 'unknown'}`), {
      name: 'ConnectorError',
      status: 400,
    })
  }
  return parsed.data as Record<string, unknown>
}

function sanitize(row: {
  id: string
  kind: string
  config: string
  lastSyncAt: Date | null
  lastSyncStatus: string | null
  lastSyncSummary: string | null
  projectId: string
}): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    config: JSON.parse(row.config),
    projectId: row.projectId,
    hasCredentials: false, // overridden by caller with the real flag
    lastSyncAt: row.lastSyncAt,
    lastSyncStatus: row.lastSyncStatus,
    lastSyncSummary: row.lastSyncSummary,
  }
}

export const GET = withErrorHandler(async (req: NextRequest) => {
  await requireRole(['admin'])
  const projectId = req.nextUrl.searchParams.get('projectId')
  const clientId = req.nextUrl.searchParams.get('clientId')
  if (!projectId && !clientId) return invalidRequest('projectId or clientId query parameter is required')

  let resolvedProjectId = projectId
  if (!resolvedProjectId && clientId) {
    const client = await db.client.findUnique({
      where: { id: clientId },
      include: { contracts: { include: { projects: { select: { id: true } } } } },
    })
    if (!client) return notFound('client not found')
    resolvedProjectId = client.contracts[0]?.projects[0]?.id ?? null
    if (!resolvedProjectId) {
      return ok({ connectors: [], note: 'client has no project yet — intake the SOW first' })
    }
  }

  const rows = await db.connectorSource.findMany({
    where: { projectId: resolvedProjectId as string },
    orderBy: { createdAt: 'asc' },
  })
  return ok({
    connectors: rows.map(r => ({
      ...sanitize(r),
      hasCredentials: r.credentialsSealed !== null,
    })),
  })
})

export const PUT = withErrorHandler(async (req: NextRequest) => {
  const actor = await requireRole(['admin'])
  const requestId = await getRequestId()

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return invalidRequest('invalid json')
  const { projectId, clientId, kind, config, credentials } = body as {
    projectId?: unknown
    clientId?: unknown
    kind?: unknown
    config?: unknown
    credentials?: unknown
  }

  if (typeof kind !== 'string' || !CONNECTOR_KINDS.includes(kind as ConnectorKind)) {
    return invalidRequest(`kind must be one of: ${CONNECTOR_KINDS.join(', ')}`)
  }
  const validatedConfig = validateConfig(kind as ConnectorKind, config)

  // Resolve the target project the same way /api/ingest does.
  let targetProject: { id: string; tenantId: string; name: string } | null = null
  if (typeof projectId === 'string' && projectId) {
    targetProject = await db.project.findUnique({
      where: { id: projectId },
      select: { id: true, tenantId: true, name: true },
    })
  } else if (typeof clientId === 'string' && clientId) {
    const client = await db.client.findUnique({
      where: { id: clientId },
      include: { contracts: { include: { projects: true } } },
    })
    if (!client) return notFound('client not found')
    const contract = client.contracts[0]
    if (!contract) return fail('client has no contract — intake the SOW first', 409)
    const existingProject = contract.projects[0]
    const tenantId = currentTenantId()
    if (!tenantId) {
      return NextResponse.json({ ok: false, error: 'no tenant context' }, { status: 500 })
    }
    targetProject = existingProject
      ? { id: existingProject.id, tenantId: existingProject.tenantId, name: existingProject.name }
      : await db.project.create({
          data: {
            tenantId,
            clientId: client.id,
            contractId: contract.id,
            name: contract.title,
            status: 'active',
            startDate: contract.effectiveDate,
          },
          select: { id: true, tenantId: true, name: true },
        })
  } else {
    return invalidRequest('projectId or clientId is required')
  }

  // Tenant guard: the project must belong to the caller's tenant (scoped
  // read masks cross-tenant rows as null → 404).
  if (!targetProject) return notFound('project not found')
  const project = targetProject
  const tenantId = project.tenantId

  // Credential hygiene: only known keys are sealed; unknown keys are a
  // client bug, not something to persist silently.
  let sealed: string | null | undefined
  if (credentials !== undefined && credentials !== null) {
    if (typeof credentials !== 'object') return invalidRequest('credentials must be an object')
    const c = credentials as Record<string, unknown>
    if (kind === 'github') {
      const token = typeof c.token === 'string' ? c.token.trim() : ''
      sealed = token ? sealSecret({ token }) : null
    } else {
      const apiToken = typeof c.apiToken === 'string' ? c.apiToken.trim() : ''
      const email = typeof c.email === 'string' ? c.email.trim() : ''
      if (!apiToken || !email) return invalidRequest('jira credentials require email and apiToken')
      sealed = sealSecret({ apiToken, email })
    }
  }

  const row = await db.connectorSource.upsert({
    where: { projectId_kind: { projectId: project.id, kind: kind as ConnectorKind } },
    create: {
      tenantId,
      projectId: project.id,
      kind,
      config: JSON.stringify(validatedConfig),
      credentialsSealed: sealed ?? null,
      createdById: actor.id,
    },
    update: {
      config: JSON.stringify(validatedConfig),
      ...(sealed !== undefined ? { credentialsSealed: sealed } : {}),
    },
  })

  await db.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actor: actor.email,
      action: 'connector_saved',
      entityType: 'connector',
      entityId: row.id,
      detail: `${kind} connector ${sealed !== undefined ? 'configured (credentials ' + (sealed ? 'updated' : 'cleared') + ')' : 'configured'} for project ${project.name}` +
        (requestId ? ` (request ${requestId})` : ''),
      requestId: requestId ?? undefined,
    },
  })

  return ok({
    connector: {
      id: row.id,
      kind: row.kind,
      config: JSON.parse(row.config),
      projectId: row.projectId,
      hasCredentials: row.credentialsSealed !== null,
      lastSyncAt: row.lastSyncAt,
      lastSyncStatus: row.lastSyncStatus,
      lastSyncSummary: row.lastSyncSummary,
    },
  })
})

export const DELETE = withErrorHandler(async (req: NextRequest) => {
  const actor = await requireRole(['admin'])
  const requestId = await getRequestId()
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return invalidRequest('id query parameter is required')

  const row = await db.connectorSource.findUnique({
    where: { id },
    select: { id: true, kind: true, projectId: true, tenantId: true },
  })
  if (!row) return notFound('connector not found')

  await db.connectorSource.delete({ where: { id } })

  await db.auditLog.create({
    data: {
      tenantId: row.tenantId,
      actorId: actor.id,
      actor: actor.email,
      action: 'connector_deleted',
      entityType: 'connector',
      entityId: id,
      detail: `${row.kind} connector removed`,
      requestId: requestId ?? undefined,
    },
  })

  return ok({ deleted: id })
})
