import { z } from 'zod'

/**
 * Centralized Zod schemas for every API request body in GAVEL.
 *
 * Why: the previous routes hand-rolled validation per-endpoint, leading to
 * inconsistent error envelopes, missing checks (e.g. email format, length
 * caps), and silent `.catch(() => ({}))` swallowing of malformed JSON.
 *
 * Usage:
 *   import { CreateClientSchema } from '@/lib/schemas'
 *   const result = CreateClientSchema.safeParse(body)
 *   if (!result.success) return NextResponse.json({ ok: false, error: ... }, { status: 400 })
 *   const data: CreateClient = result.data
 */

// ────────────────────────────── Clients ──────────────────────────────

export const CreateClientSchema = z.object({
  name: z.string().trim().min(1, 'name required').max(200),
  industry: z.string().trim().max(200).optional(),
  sizeBand: z
    .enum(['1-10', '10-50', '50-200', '200-1000', '1000+'])
    .optional()
    .or(z.literal('').transform(() => undefined)),
  contactName: z.string().trim().max(200).optional(),
  contactEmail: z
    .string()
    .trim()
    .email('invalid email')
    .max(254)
    .optional()
    .or(z.literal('').transform(() => undefined)),
})
export type CreateClient = z.infer<typeof CreateClientSchema>

// ──────────────────────────── Extract contract ──────────────────────

export const ExtractContractSchema = z.object({
  rawText: z
    .string()
    .trim()
    .min(30, 'rawText is required (min 30 chars)')
    .max(256_000, 'rawText exceeds 256KB limit'),
  persist: z.boolean().optional().default(false), // safer default than the previous `true`
  clientId: z.string().cuid().optional(),
})
export type ExtractContract = z.infer<typeof ExtractContractSchema>

// ───────────────────────────── Findings PATCH ────────────────────────

export const FindingAction = z.enum(['approve', 'dismiss', 'escalate'])
export type FindingActionT = z.infer<typeof FindingAction>

export const PatchFindingSchema = z.object({
  action: FindingAction,
  reviewNotes: z.string().trim().max(10_000).optional(),
  // NOTE: `actor` is taken from the request for now (the middleware will
  // eventually populate `X-Gavel-Actor` from a session). The body
  // value is ignored if a header is present — see src/lib/actor.ts.
  actor: z.string().trim().max(254).optional(),
})
export type PatchFinding = z.infer<typeof PatchFindingSchema>

// ───────────────────────────── Pagination (shared) ───────────────────

export const PaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
export type Pagination = z.infer<typeof PaginationSchema>

// ───────────────────────── Alert ack ─────────────────────────────────

export const AckAlertSchema = z.object({
  acknowledged: z.boolean(),
})
export type AckAlert = z.infer<typeof AckAlertSchema>

// ───────────────────────── Monitoring toggle ─────────────────────────

export const ToggleMonitoringSchema = z.object({
  alertsEnabled: z.boolean(),
})
export type ToggleMonitoring = z.infer<typeof ToggleMonitoringSchema>

// ───────────────────────── Remote source fetch (SOW intake) ─────────
// POST /api/sources/fetch — pull contract text from a published URL or
// a GitHub repo file instead of pasting it. See src/lib/sources/.

export const SourceFetchUrlSchema = z.object({
  kind: z.literal('url'),
  url: z
    .string()
    .trim()
    .min(8, 'url required')
    .max(2048)
    .regex(/^https:\/\//i, 'only https:// URLs can be fetched'),
})

export const SourceFetchGithubSchema = z.object({
  kind: z.literal('github'),
  owner: z.string().trim().min(1, 'owner required').max(100),
  repo: z.string().trim().min(1, 'repo required').max(150),
  path: z.string().trim().min(1, 'file path required').max(500),
  ref: z.string().trim().min(1).max(200).optional(),
  token: z.string().trim().min(1).max(400).optional(),
})

export const SourceFetchSchema = z.discriminatedUnion('kind', [
  SourceFetchUrlSchema,
  SourceFetchGithubSchema,
])
export type SourceFetch = z.infer<typeof SourceFetchSchema>
