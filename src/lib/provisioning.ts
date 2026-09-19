// GAVEL — user provisioning helpers (production blocker #3).
//
// Everything an tenant admin can do to accounts, with the guards that keep
// a tenant administrable without a platform operator:
//   - cross-tenant targeting is impossible (tenanted lookup + 404 masking)
//   - the last active admin of a tenant cannot be demoted or disabled
//   - nobody can disable or demote themselves (self-lockout)
//   - every revoke-worthy mutation bumps User.tokenEpoch → all outstanding
//     JWTs for that user die at the next request (≤30s cross-instance,
//     immediately on the instance that made the change)
//   - the principal cache is invalidated eagerly so changes apply instantly

import { db } from './db'
import { signPurposeToken, INVITE_TTL_SECONDS, RESET_TTL_SECONDS, type UserRole } from './auth'
import { invalidatePrincipal } from './request-principal'
import { currentTenantId } from './tenant-context'

export const PROVISIONABLE_ROLES: UserRole[] = ['viewer', 'reviewer', 'admin']

export interface SanitizedUser {
  id: string
  email: string
  name: string | null
  role: string
  status: string
  tenantId: string | null
  hasPassword: boolean
  createdAt: Date
}

/** Strip everything sensitive off a user row before returning it. */
export function sanitizeUser(u: {
  id: string
  email: string
  name: string | null
  role: string
  status: string
  tenantId: string | null
  passwordHash: string | null
  createdAt: Date
}): SanitizedUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    tenantId: u.tenantId,
    hasPassword: u.passwordHash !== null,
    createdAt: u.createdAt,
  }
}

/**
 * Fetch a user by id, but ONLY if they belong to the caller's tenant.
 * Returns null for missing AND cross-tenant rows alike — a foreign user id
 * is indistinguishable from a nonexistent one (no existence oracle).
 * The returned tenantId is guaranteed non-null: a match implies the
 * caller's tenant context was non-null and equal.
 */
export interface TenantedUser {
  id: string
  email: string
  name: string | null
  role: string
  status: string
  tenantId: string
  passwordHash: string | null
  createdAt: Date
}

export async function findTenantedUser(userId: string): Promise<TenantedUser | null> {
  const tenantId = currentTenantId()
  if (tenantId === null) return null
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, name: true, role: true, status: true,
      tenantId: true, passwordHash: true, createdAt: true,
    },
  })
  if (!user) return null
  if (user.tenantId !== tenantId) return null
  return { ...user, tenantId }
}

/**
 * Guard: would `mutation` leave the tenant without an active admin?
 * `mutation` describes the change about to be applied to an admin user.
 * Returns an error message, or null when the change is safe.
 */
export async function lastAdminGuard(
  targetUserId: string,
  mutation: { newRole?: string; newStatus?: string }
): Promise<string | null> {
  const tenantId = currentTenantId()
  if (tenantId === null) return 'no tenant context'
  const admins = await db.user.findMany({
    where: { tenantId, role: 'admin', status: 'active' },
    select: { id: true },
  })
  if (admins.length === 0) return null // already degenerate — don't block cleanup
  if (admins.length > 1) return null // another admin remains
  const only = admins[0]
  if (!only || only.id !== targetUserId) return null
  if (mutation.newRole !== undefined && mutation.newRole !== 'admin') {
    return 'cannot demote the last active admin of this tenant'
  }
  if (mutation.newStatus !== undefined && mutation.newStatus !== 'active') {
    return 'cannot disable the last active admin of this tenant'
  }
  return null
}

/** Bump the token epoch + evict the cached principal — the revoke pair. */
export async function revokeSessions(userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { tokenEpoch: { increment: 1 } },
  })
  invalidatePrincipal(userId)
}

export interface IssuedLink {
  token: string
  /** Relative URL — prefix with the public app URL when sharing. */
  path: string
  expiresInSeconds: number
}

/** Mint an invite link for a freshly created (password-less) user. */
export function issueInvite(userId: string): IssuedLink {
  const token = signPurposeToken('invite', userId)
  return { token, path: `/login?invite=${encodeURIComponent(token)}`, expiresInSeconds: INVITE_TTL_SECONDS }
}

/** Mint a password-reset link (also revives invite-pending users). */
export function issueReset(userId: string): IssuedLink {
  const token = signPurposeToken('reset', userId)
  return { token, path: `/login?invite=${encodeURIComponent(token)}`, expiresInSeconds: RESET_TTL_SECONDS }
}

/** Public base for links: NEXT_PUBLIC_APP_URL when configured, else ''. */
export function publicBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? ''
}
