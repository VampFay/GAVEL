// GAVEL — DNS-pinned HTTP client (WP 1.3).
//
// Closes the TOCTOU (time-of-check to time-of-use) DNS-rebinding window in
// server-side URL fetching: with native fetch, the SSRF guard validates the
// addresses dns.resolve() returns, then fetch() resolves the hostname AGAIN
// — a rebinding attacker answers the second lookup with 169.254.169.254.
//
// This client resolves ONCE, validates EVERY returned address, and dials
// the validated IP directly while preserving the original Host header and
// TLS SNI (node:https `servername`), so certificates and virtual hosts
// still work. There is no second resolution anywhere on the request path.
//
// Portability: node:http/node:https only — works under both Node and Bun
// (Bun's fetch does not support undici dispatchers, so an Agent-based
// approach was ruled out).
//
// Redirects: deliberately NOT followed. Callers (fetch-remote.ts) follow
// manually and re-run THIS client per hop, so every hop is re-pinned.

import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { isPrivateAddress } from '../sources/fetch-remote'

export interface PinnedFetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string | Buffer | Uint8Array
  signal?: AbortSignal
  /** Test seam: inject DNS resolution (default node:dns). */
  lookupImpl?: (hostname: string) => Promise<Array<{ address: string; family: number }>>
}

export interface PinnedRequestPlan {
  url: URL
  /** The IP the connection is dialed to — the validated, pinned address. */
  ip: string
  family: number
  /** True when the hostname was already an IP literal (no DNS involved). */
  literal: boolean
}

/** Resolve + validate, returning the connection plan. Exported for tests. */
export async function planRequest(
  rawUrl: string,
  lookupImpl: PinnedFetchInit['lookupImpl'] = defaultLookup,
): Promise<PinnedRequestPlan> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw Object.assign(new Error('not a valid URL'), { status: 400 })
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw Object.assign(new Error('only https:// (and http://) URLs can be fetched'), { status: 400 })
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '')

  // IP literal: validate directly, no DNS (and no rebinding surface).
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(':')) {
    if (isPrivateAddress(hostname)) {
      throw Object.assign(new Error('refusing to fetch a private/loopback address'), { status: 400 })
    }
    return { url, ip: hostname, family: hostname.includes(':') ? 6 : 4, literal: true }
  }

  // Single resolution — THE fix. Every record must be public; a mixed
  // answer (one public, one private) is treated as a rebinding attempt.
  let records: Array<{ address: string; family: number }>
  try {
    records = await lookupImpl(hostname)
  } catch {
    throw Object.assign(new Error(`DNS lookup failed for ${hostname}`), { status: 400 })
  }
  if (!records || records.length === 0) {
    throw Object.assign(new Error('host does not resolve'), { status: 400 })
  }
  for (const r of records) {
    if (isPrivateAddress(r.address)) {
      throw Object.assign(
        new Error('host resolves to a private address — refusing (SSRF guard)'),
        { status: 400 },
      )
    }
  }
  const pinned = records[0]!
  return { url, ip: pinned.address, family: pinned.family, literal: false }
}

async function defaultLookup(hostname: string) {
  return dns.lookup(hostname, { all: true })
}

/**
 * Fetch a URL with the connection pinned to the validated IP. Returns a
 * standard Response (status/headers/body) so callers can treat it exactly
 * like fetch(). Redirects are NOT followed — see header comment.
 */
export async function pinnedFetch(rawUrl: string, init: PinnedFetchInit = {}): Promise<Response> {
  const plan = await planRequest(rawUrl, init.lookupImpl)
  const { url, ip } = plan

  return new Promise<Response>((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http
    const req = lib.request(
      {
        // Dial the validated IP; keep Host header + TLS SNI on the original
        // hostname (node:https uses `servername` for SNI AND certificate
        // validation, so cert checking still binds to the real domain).
        host: ip,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        servername: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: init.method ?? 'GET',
        headers: {
          Host: url.host, // hostname:port exactly as a browser would send
          ...(init.headers ?? {}),
        },
        ...(url.protocol === 'https:' ? { rejectUnauthorized: true } : {}),
      },
      res => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const body = Buffer.concat(chunks)
          resolve(
            new Response(new Uint8Array(body), {
              status: res.statusCode ?? 0,
              headers: res.headers as Record<string, string>,
            }),
          )
        })
        res.on('error', reject)
      },
    )

    req.on('error', reject)
    if (init.signal) {
      const onAbort = () => {
        req.destroy(new Error(`request aborted: ${init.signal!.reason ?? 'timeout'}`))
      }
      if (init.signal.aborted) onAbort()
      else init.signal.addEventListener('abort', onAbort, { once: true })
    }
    if (init.body !== undefined) {
      req.write(init.body)
    }
    req.end()
  })
}
