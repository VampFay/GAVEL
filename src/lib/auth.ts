import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { db } from './db'
import { getEnv } from './env'

/**
 * Real per-user authentication — replaces the shared-bearer-token gate that
 * used to be the only thing between an attacker and the mutating API.
 *
 * Design:
 *   - Hand-rolled HS256 JWT (zero auth deps — if SSO is ever required,
 *     add `next-auth` THEN, not before; for the sandbox / first paying
 *     customer, a Credentials-style flow is fine and much simpler to audit).
 *   - The token payload is `{ sub, email, role, iat, exp }` — signed with
 *     `GAVEL_JWT_SECRET` (HMAC-SHA256).
 *   - Middleware verifies the token on every request and stamps the
 *     VERIFIED identity into request headers (`x-gavel-actor`,
 *     `x-gavel-user-id`, `x-gavel-role`). Route handlers MUST
 *     read these middleware-stamped headers — never the client-supplied
 *     `x-gavel-actor` header directly (that was the spoofing hole).
 *   - `requireRole(['reviewer','admin'])` gates specific mutations.
 *   - Password hashing uses `scrypt` (built into node:crypto) — slow + salted.
 *
 * What this is NOT:
 *   - Not a full OAuth provider integration. When the first real customer
 *     needs SSO, wire `next-auth` with the appropriate provider and replace
 *     `signToken` / `verifyToken` with `getServerSession`.
 *   - Not a refresh-token flow. Tokens last 7 days; re-login on expiry.
 *   - Not CSRF protection for cookie-based auth. The login form exists
 *     and posts JSON: SameSite=Strict + JSON-only bodies + no CORS close
 *     the CSRF surface for this architecture (rationale documented in
 *     src/lib/auth-cookie.ts). Server-rendered HTML forms, if ever added,
 *     would need a double-submit token.
 */

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60 // 7 days

export interface AuthClaims {
  sub: string         // User.id
  email: string
  role: UserRole
  epoch: number       // User.tokenEpoch at issue time — mismatch = revoked
  iat: number         // issued-at, seconds
  exp: number         // expires-at, seconds
}

export type UserRole = 'viewer' | 'reviewer' | 'admin'

/** Role precedence: viewer < reviewer < admin. */
const ROLE_RANK: Record<UserRole, number> = {
  viewer: 0,
  reviewer: 1,
  admin: 2,
}

/** Throw if GAVEL_JWT_SECRET is missing or pathologically short. */
function getJwtSecret(): string {
  const env = getEnv()
  const secret = process.env.GAVEL_JWT_SECRET
  if (!secret || secret.length < 32) {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'GAVEL_JWT_SECRET must be set to a random string of >=32 chars in production'
      )
    }
    // Dev fallback: deterministic so the sandbox works out of the box.
    // LOG loud because no real customer data should ever live behind this.
    console.warn(
      '⚠️  GAVEL_JWT_SECRET not set (or < 32 chars) — using insecure dev fallback. ' +
      'NEVER deploy this to production.'
    )
    return 'dev-only-DO-NOT-USE-IN-PRODUCTION-000000000000000000'
  }
  return secret
}

/**
 * Sign an HS256 JWT for a verified user. `epoch` is the user's current
 * tokenEpoch — bumping the column (disable, password reset, role change)
 * retroactively invalidates every token signed with an older epoch.
 */
export function signToken(claims: Omit<AuthClaims, 'iat' | 'exp'>): string {
  const iat = Math.floor(Date.now() / 1000)
  const exp = iat + TOKEN_TTL_SECONDS
  const full: AuthClaims = { ...claims, iat, exp }

  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = { ...full }

  const encHeader = b64url(JSON.stringify(header))
  const encPayload = b64url(JSON.stringify(payload))
  const signingInput = `${encHeader}.${encPayload}`
  const sig = hmacSha256(signingInput, getJwtSecret())
  return `${signingInput}.${sig}`
}

/**
 * Verify an HS256 JWT. Returns the claims if valid, or `null` if:
 *   - signature is invalid
 *   - token is expired
 *   - payload is malformed
 *
 * Uses timingSafeEqual to compare signatures — constant-time, no oracle.
 */
export function verifyToken(token: string): AuthClaims | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const encHeader = parts[0]
  const encPayload = parts[1]
  const sig = parts[2]
  if (encHeader == null || encPayload == null || sig == null) return null
  const signingInput = `${encHeader}.${encPayload}`

  // Constant-time signature comparison.
  const expected = hmacSha256(signingInput, getJwtSecret())
  if (expected.length !== sig.length) return null
  try {
    const a = Buffer.from(sig, 'base64url')
    const b = Buffer.from(expected, 'base64url')
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  } catch {
    return null
  }

  // Decode + validate payload.
  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(encPayload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  if (typeof p.sub !== 'string' || typeof p.email !== 'string' || typeof p.role !== 'string') {
    return null
  }
  if (p.role !== 'viewer' && p.role !== 'reviewer' && p.role !== 'admin') return null
  if (typeof p.iat !== 'number' || typeof p.exp !== 'number') return null
  if (Date.now() / 1000 >= p.exp) return null

  return {
    sub: p.sub,
    email: p.email,
    role: p.role,
    epoch: typeof p.epoch === 'number' ? p.epoch : 0, // legacy tokens = epoch 0
    iat: p.iat,
    exp: p.exp,
  }
}

/**
 * Hash a password using scrypt + random salt.
 * Returns a string of the form `scrypt:<saltHex>:<hashHex>` suitable for
 * storage in the User.passwordHash column.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSyncAwaitable(password, salt, 64)
  return `scrypt:${salt}:${hash}`
}

/** Promisified scrypt so we don't block the event loop on long hashes. */
function scryptSyncAwaitable(password: string, salt: string, keylen: number): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { scryptSync } = require('node:crypto')
  return scryptSync(password, salt, keylen).toString('hex')
}

/**
 * Verify a password against a stored `scrypt:<salt>:<hash>` string.
 * Returns true on match, false on any failure (missing fields, wrong
 * algorithm, hash mismatch). Constant-time on the hash comparison.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const { scryptSync, timingSafeEqual: tse } = await import('node:crypto')
  const parts = stored.split(':')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const salt = parts[1]
  const expectedHex = parts[2]
  if (salt == null || expectedHex == null) return false
  const computed = scryptSync(password, salt, 64)
  const expected = Buffer.from(expectedHex, 'hex')
  if (computed.length !== expected.length) return false
  return tse(computed, expected)
}

/**
 * Result of `requireActor()` — the verified identity of the caller,
 * suitable for stamping into AuditLog.actor and for role-based gating.
 */
export interface VerifiedActor {
  id: string      // User.id
  email: string
  role: UserRole
}

/**
 * Read the verified actor from request headers (set by middleware).
 *
 * CRITICAL: middleware only sets these headers if the JWT verified. A
 * client-supplied `x-gavel-actor` header is ignored — that was the
 * spoofing hole the audit flagged. If you find code reading actor from
 * the inbound request body or from a header the client controls, that
 * is a bug.
 *
 * Returns `null` if the request is unauthenticated.
 */
export async function getServerActor(): Promise<VerifiedActor | null> {
  const h = await import('next/headers')
  const headersList = await h.headers()
  const id = headersList.get('x-gavel-user-id')
  const email = headersList.get('x-gavel-actor')
  const role = headersList.get('x-gavel-role')
  if (!id || !email || !role) return null
  if (role !== 'viewer' && role !== 'reviewer' && role !== 'admin') return null
  return { id, email, role }
}

/**
 * Throw-friendly helper: require any authenticated actor.
 * Use at the top of any GET route that returns client data.
 *
 * Returns a 401-friendly error if not authenticated — callers should
 * propagate this via `withErrorHandler`.
 */
export async function requireActor(): Promise<VerifiedActor> {
  const actor = await getServerActor()
  if (!actor) {
    throw new AuthError('unauthorized', 401)
  }
  return actor
}

/**
 * Require that the caller has one of the specified roles (or higher).
 *
 * Usage:
 *   const actor = await requireRole(['reviewer', 'admin']) // reviewer-or-admin
 *   const actor = await requireRole(['admin'])              // admin only
 *
 * Throws AuthError(401) if unauthenticated, AuthError(403) if role insufficient.
 */
export async function requireRole(roles: UserRole[]): Promise<VerifiedActor> {
  const actor = await requireActor()
  const callerRank = ROLE_RANK[actor.role]
  const requiredRank = Math.min(...roles.map(r => ROLE_RANK[r]))
  if (callerRank < requiredRank) {
    throw new AuthError('forbidden: insufficient role', 403)
  }
  return actor
}

/**
 * Custom error class for auth failures. `withErrorHandler` maps these to
 * the correct HTTP status (401 / 403). Other errors fall through to 500.
 */
export class AuthError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'AuthError'
    this.status = status
  }
}

/**
 * Look up a user by email + verify their password. Used by the login
 * endpoint to issue a JWT.
 *
 * Rejects (returns null) when: the user doesn't exist, the password is
 * wrong, the account is DISABLED, or the password was never set (invite
 * still pending) — the last two are auth failures even with a correct
 * password, and the generic null keeps the response free of oracles.
 *
 * Returns the user record (without the hash) on success.
 */
export async function authenticate(
  email: string,
  password: string
): Promise<{ id: string; email: string; role: UserRole; name: string | null; tokenEpoch: number } | null> {
  const user = await db.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, email: true, role: true, name: true, passwordHash: true, status: true, tokenEpoch: true },
  })
  if (!user || !user.passwordHash) return null
  if (user.status === 'disabled') return null
  const ok = await verifyPassword(password, user.passwordHash)
  if (!ok) return null
  return {
    id: user.id,
    email: user.email,
    role: (user.role as UserRole) ?? 'viewer',
    name: user.name,
    tokenEpoch: user.tokenEpoch,
  }
}

// ───────────────────────────────────────────────────────────────────
// Purpose tokens (provisioning — production blocker #3)
// ───────────────────────────────────────────────────────────────────

export type PurposeTokenType = 'invite' | 'reset'

export const INVITE_TTL_SECONDS = 72 * 60 * 60 // 3 days to accept an invite
export const RESET_TTL_SECONDS = 24 * 60 * 60  // 1 day to use a reset link

interface PurposeClaims {
  purpose: PurposeTokenType
  sub: string // User.id
  iat: number
  exp: number
}

/** Sign a short-lived, single-purpose token (invite / password reset). */
export function signPurposeToken(purpose: PurposeTokenType, userId: string): string {
  const iat = Math.floor(Date.now() / 1000)
  const exp = iat + (purpose === 'invite' ? INVITE_TTL_SECONDS : RESET_TTL_SECONDS)
  const claims: PurposeClaims = { purpose, sub: userId, iat, exp }
  const encHeader = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const encPayload = b64url(JSON.stringify(claims))
  const signingInput = `${encHeader}.${encPayload}`
  return `${signingInput}.${hmacSha256(signingInput, getJwtSecret())}`
}

/** Verify a purpose token; returns the user id or null (bad/expired/wrong purpose). */
export function verifyPurposeToken(token: string, expected: PurposeTokenType): string | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [encHeader, encPayload, sig] = parts as [string, string, string]
  const signingInput = `${encHeader}.${encPayload}`
  const expectedSig = hmacSha256(signingInput, getJwtSecret())
  if (expectedSig.length !== sig.length) return null
  try {
    const a = Buffer.from(sig, 'base64url')
    const b = Buffer.from(expectedSig, 'base64url')
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  } catch {
    return null
  }
  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(encPayload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  if (p.purpose !== expected) return null
  if (typeof p.sub !== 'string' || typeof p.exp !== 'number') return null
  if (Date.now() / 1000 >= p.exp) return null
  return p.sub
}

/** NIST-style password policy: length first, no forced composition. */
export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_LENGTH = 200

/** Returns an error message, or null when the password is acceptable. */
export function passwordPolicyError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `password must be at least ${PASSWORD_MIN_LENGTH} characters`
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `password must be at most ${PASSWORD_MAX_LENGTH} characters`
  }
  // Control characters have no business in a typed password.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(password)) {
    return 'password contains control characters'
  }
  return null
}

// ───────────────────────────────────────────────────────────────────
// Internal helpers
// ───────────────────────────────────────────────────────────────────

function hmacSha256(input: string, secret: string): string {
  return createHmac('sha256', secret).update(input).digest('base64url')
}

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url')
}
