import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok } from '@/lib/api'
import { PaginationSchema } from '@/lib/schemas'
import { money } from '@/lib/money'

export const dynamic = 'force-dynamic'

/**
 * GET /api/findings
 *
 * Returns findings with optional filtering and pagination. The previous
 * implementation returned every column of every finding on every call.
 *
 * Query params:
 *   - status: pending_review|approved|dismissed|escalated
 *   - type: missed_milestone|unbilled_overage|scope_expansion|rate_discrepancy|unauthorized_work
 *   - confidence: HIGH|MEDIUM|LOW
 *   - contractId, projectId
 *   - cursor, limit
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl
  const search = url.searchParams

  const parsed = PaginationSchema.safeParse({
    cursor: search.get('cursor') ?? undefined,
    limit: search.get('limit') ?? undefined,
  })
  const limit = parsed.success ? parsed.data.limit : 50
  const cursor = parsed.success ? parsed.data.cursor : undefined

  const status = search.get('status') ?? undefined
  const type = search.get('type') ?? undefined
  const confidence = search.get('confidence') ?? undefined
  const contractId = search.get('contractId') ?? undefined
  const projectId = search.get('projectId') ?? undefined

  // Sort by numeric confidenceScore (was: alphabetical `confidence` string,
  // which ordered HIGH < LOW < MEDIUM — wrong).
  const items = await db.finding.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
      ...(confidence ? { confidence } : {}),
      ...(contractId ? { contractId } : {}),
      ...(projectId ? { projectId } : {}),
    },
    select: {
      id: true,
      contractId: true,
      projectId: true,
      type: true,
      title: true,
      summary: true,
      impactAmount: true,
      confidence: true,
      confidenceScore: true,
      assessment: true,
      recommendedAction: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      reviewedAt: true,
    },
    orderBy: [{ confidenceScore: 'desc' }, { impactAmount: 'desc' }],
    take: limit + 1, // +1 to detect "has next page"
    ...(cursor
      ? { cursor: { id: cursor }, skip: 1 }
      : {}),
  })

  const hasMore = items.length > limit
  const data = (hasMore ? items.slice(0, limit) : items).map(f => ({
    ...f,
    // Decimal → number at the response boundary (see src/lib/money.ts).
    impactAmount: money(f.impactAmount),
  }))
  const nextCursor = hasMore && data.length > 0 ? data[data.length - 1]?.id : null

  return ok({ findings: data, nextCursor, hasMore })
}
