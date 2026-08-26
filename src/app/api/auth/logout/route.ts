import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api'
import { clearAuthCookie } from '@/lib/auth-cookie'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/logout
 *
 * Clears the auth cookie. Idempotent — calling when not logged in is a 200.
 */
export const POST = withErrorHandler(async () => {
  const res = NextResponse.json({ ok: true })
  return clearAuthCookie(res)
})
