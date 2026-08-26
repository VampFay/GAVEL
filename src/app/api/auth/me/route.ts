import { NextRequest } from 'next/server'
import { ok, unauthorized } from '@/lib/api'
import { withErrorHandler } from '@/lib/api'
import { getServerActor } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/me
 *
 * Returns the verified caller's identity (or 401 if not authenticated).
 * Used by the client to hydrate the logged-in state on page load.
 */
export const GET = withErrorHandler(async (_req: NextRequest) => {
  const actor = await getServerActor()
  if (!actor) return unauthorized()
  return ok({ user: actor })
})
