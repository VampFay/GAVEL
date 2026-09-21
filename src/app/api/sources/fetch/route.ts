import { NextRequest, NextResponse } from 'next/server'
import { ok, invalidRequest, withErrorHandler } from '@/lib/api'
import { SourceFetchSchema } from '@/lib/schemas'
import { getRequestId } from '@/lib/actor'
import { requireRole } from '@/lib/auth'
import { db } from '@/lib/db'
import { currentTenantId } from '@/lib/tenant-context'
import { fetchTextFromGithub, fetchTextFromUrl, type FetchedText } from '@/lib/sources/fetch-remote'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Remote source fetch for SOW/contract intake — the "link the service
 * instead of pasting" endpoint (counterpart to the Evidence step's
 * saved connectors).
 *
 * POST /api/sources/fetch
 *   { kind: 'url',    url: 'https://…' }                  — any published text/HTML page
 *   { kind: 'github', owner, repo, path, ref?, token? }   — a file in a repository
 *
 * Returns { ok, text, source: { kind, label, contentType, bytes, finalUrl } }.
 * The CLIENT decides what happens next: the text fills the editable SOW
 * textarea for human review, then the existing /api/extract-contract
 * pipeline runs on it. This route never persists contract data itself —
 * it is a fetch, not an ingestion.
 *
 * Auth: admin (same privilege as extraction — this is the front door of
 * the intake that poisons every downstream finding if abused).
 * SSRF: enforced in src/lib/sources/fetch-remote.ts (https-only, private
 * IP blocking incl. DNS resolution, manual redirect re-validation,
 * timeouts, size caps). Every fetch is audit-logged with its label.
 */

export const POST = withErrorHandler(async (req: NextRequest) => {
  const actor = await requireRole(['admin'])
  const requestId = await getRequestId()

  const raw = await req.text()
  let body: unknown
  try {
    body = raw ? JSON.parse(raw) : {}
  } catch {
    return invalidRequest('invalid json')
  }
  const parsed = SourceFetchSchema.safeParse(body)
  if (!parsed.success) return invalidRequest(parsed.error)
  const input = parsed.data

  const fetched: FetchedText =
    input.kind === 'url'
      ? await fetchTextFromUrl(input.url)
      : await fetchTextFromGithub({
          owner: input.owner,
          repo: input.repo,
          path: input.path,
          ref: input.ref,
          token: input.token,
        })

  const label =
    input.kind === 'url'
      ? input.url
      : `github.com/${input.owner}/${input.repo}${input.ref ? `@${input.ref}` : ''} — ${input.path}`

  if (fetched.text.trim().length < 30) {
    return invalidRequest(
      'the fetched source has less than 30 characters of text — it is not a contract'
    )
  }

  // Evidence trail: who pulled which source, when, and how big. The
  // contract row itself stores rawText (with a provenance header added
  // client-side), so the audit log + rawText together reconstruct the
  // chain without a schema change.
  const tenantId = currentTenantId()
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: 'no tenant context' }, { status: 500 })
  }
  await db.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actor: actor.email,
      action: 'source_fetch',
      entityType: 'sow_source',
      entityId: label.slice(0, 190),
      detail: `fetched ${fetched.bytes} bytes from ${label}` +
        (requestId ? ` (request ${requestId})` : ''),
      requestId: requestId ?? undefined,
    },
  })

  return ok({
    text: fetched.text,
    source: {
      kind: input.kind,
      label,
      contentType: fetched.contentType,
      bytes: fetched.bytes,
      finalUrl: fetched.finalUrl,
    },
  })
})
