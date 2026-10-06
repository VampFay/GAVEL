// GAVEL — remote source fetching for contract/SOW intake (extends the
// connector story, production blocker #4, to the contract side).
//
// The Evidence step pulls DELIVERY records via saved connectors
// (src/lib/connectors/*). This module is the CONTRACT-side counterpart:
// fetch the SOW text itself from where it already lives — a published
// URL (Confluence export, Google Docs "publish to web", a raw file) or
// a file inside a GitHub repository — so nobody has to paste walls of
// text into a textarea.
//
// The fetched text lands in the SAME review-before-extract flow: it
// fills the editable textarea, a human eyeballs it, then the LLM
// extraction pipeline runs unchanged. Fetching is intake, not trust.
//
// Security posture (this is a server-side fetcher, so SSRF is the
// threat model):
//   - https-only, always
//   - IP-literal and DNS-resolved addresses are checked against
//     private/reserved ranges before ANY request is made
//   - redirects are followed MANUALLY (max 3) so every hop is
//     re-validated — a public URL that 302s to 169.254.169.254 is
//     refused, not followed
//   - 20s timeout, 2 MB response cap, text-only content types
//
// fetchImpl is injectable so unit tests never touch the network
// (same convention as src/lib/connectors/github.ts).

import dns from 'node:dns/promises'
import { ConnectorError } from '@/lib/connectors/types'
import { pinnedFetch } from '@/lib/net/pinned-fetch'

const MAX_BYTES = 2 * 1024 * 1024
const TIMEOUT_MS = 20_000
const MAX_REDIRECTS = 3
const GH_API = 'https://api.github.com'

export class SourceFetchError extends ConnectorError {
  constructor(message: string, status = 502) {
    super(message, status)
    this.name = 'SourceFetchError'
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/**
 * WP 1.3: the DEFAULT transport is the DNS-pinned client — resolve once,
 * validate every address, dial the validated IP with the original Host
 * header and SNI. This closes the TOCTOU rebinding window that a plain
 * fetch() leaves open (validation lookup ≠ connection lookup).
 * fetchImpl stays injectable so unit tests never touch the network.
 */
const pinnedFetchLike: FetchLike = (url, init = {}) =>
  pinnedFetch(url, {
    method: init.method,
    headers: init.headers as Record<string, string> | undefined,
    body: init.body as string | Buffer | Uint8Array | undefined,
    signal: init.signal ?? undefined,
  })

// ───────────────────────── IP / host validation ─────────────────────────

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return null
  const parts = m.slice(1).map(Number)
  if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) return null
  const [a = 0, b = 0, c = 0, d = 0] = parts
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0
}

/** True when the address is private, loopback, link-local, or reserved. */
export function isPrivateAddress(host: string): boolean {
  // NOTE: WHATWG URL.hostname KEEPS the brackets on IPv6 literals
  // ("[::1]"), while dns.lookup returns bare addresses — normalize first.
  const bare = host.replace(/^\[|\]$/g, '')
  // IPv4 literals
  const v4 = ipv4ToInt(bare)
  if (v4 !== null) {
    const ranges: Array<[number, number]> = [
      [0x00000000, 0x00000000], // 0.0.0.0/8
      [0x0A000000, 0x0AFFFFFF], // 10.0.0.0/8
      [0x64400000, 0x647FFFFF], // 100.64.0.0/10 (CGNAT)
      [0x7F000000, 0x7FFFFFFF], // 127.0.0.0/8
      [0xA9FE0000, 0xA9FEFFFF], // 169.254.0.0/16
      [0xAC100000, 0xAC1FFFFF], // 172.16.0.0/12
      [0xC0A80000, 0xC0A8FFFF], // 192.168.0.0/16
      [0xC6120000, 0xC613FFFF], // 198.18.0.0/15 (RFC 2544 benchmarking)
      [0xE0000000, 0xFFFFFFFF], // 224.0.0.0/4 + 240.0.0.0/4
    ]
    return ranges.some(([lo, hi]) => v4 >= lo && v4 <= hi)
  }
  // IPv6 (brackets already stripped above)
  const v6 = bare.toLowerCase()
  if (v6 === '::1' || v6 === '::') return true
  if (v6.startsWith('fc') || v6.startsWith('fd')) return true // fc00::/7 ULA
  if (v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb')) return true // link-local
  if (v6.startsWith('ff')) return true // multicast
  // IPv4-mapped — validate the embedded v4. TWO textual forms, because
  // WHATWG URL normalizes "::ffff:10.0.0.1" into the hex-group form
  // "::ffff:a00:1" (caught live by the WP 1.3 test suite).
  const mappedDotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6)
  if (mappedDotted?.[1]) return isPrivateAddress(mappedDotted[1])
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6)
  if (mappedHex) {
    const hi = parseInt(mappedHex[1]!, 16)
    const lo = parseInt(mappedHex[2]!, 16)
    const dotted = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`
    return isPrivateAddress(dotted)
  }
  return false
}

/**
 * Validate a URL for server-side fetching: https, non-private host
 * (literal AND every DNS-resolved address). Returns the normalized URL.
 */
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new SourceFetchError('not a valid URL', 400)
  }
  if (url.protocol !== 'https:') {
    throw new SourceFetchError('only https:// URLs can be fetched', 400)
  }
  if (isPrivateAddress(url.hostname)) {
    throw new SourceFetchError('refusing to fetch a private/loopback address', 400)
  }
  // DNS-resolve and check every address (SSRF via DNS rebinding guard).
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) && !url.hostname.includes(':')) {
    try {
      const records = await dns.lookup(url.hostname, { all: true })
      if (records.length === 0) {
        throw new SourceFetchError('host does not resolve', 400)
      }
      for (const r of records) {
        if (isPrivateAddress(r.address)) {
          throw new SourceFetchError(
            'host resolves to a private address — refusing (SSRF guard)',
            400
          )
        }
      }
    } catch (e) {
      if (e instanceof SourceFetchError) throw e
      throw new SourceFetchError(`DNS lookup failed for ${url.hostname}`, 400)
    }
  }
  return url
}

// ───────────────────────── body reading ─────────────────────────

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return res.text() // no stream (tests / weird runtimes)
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => {})
      throw new SourceFetchError(`source exceeds the ${MAX_BYTES / 1024 / 1024} MB cap`, 413)
    }
    chunks.push(value)
  }
  const merged = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    merged.set(c, off)
    off += c.byteLength
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged)
}

// ───────────────────────── HTML → text ─────────────────────────

/**
 * Minimal, dependency-free HTML→text for published-doc URLs. Deliberately
 * crude: block tags become newlines, everything else becomes whitespace,
 * common entities are decoded. The LLM extraction step tolerates layout
 * noise; it cannot tolerate raw HTML soup, so we strip the soup.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/td|\/th|\/h[1-6]|\/blockquote)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&hellip;/gi, '…')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&#(\d+);/g, (_, d: string) => {
      try {
        return String.fromCodePoint(Number(d))
      } catch {
        return ' '
      }
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ───────────────────────── URL fetch ─────────────────────────

export interface FetchedText {
  text: string
  contentType: string | null
  bytes: number
  finalUrl: string
}

function isTextualContentType(ct: string | null): boolean {
  if (!ct) return true // no header — give it the benefit of the doubt
  const base = (ct.split(';')[0] ?? '').trim().toLowerCase()
  return (
    base.startsWith('text/') ||
    base === 'application/json' ||
    base === 'application/xml' ||
    base === 'application/rtf' ||
    base === 'application/x-yaml'
  )
}

/**
 * Fetch a remote https URL as text. Redirects are followed manually and
 * every hop re-validated against the SSRF guard.
 */
export async function fetchTextFromUrl(
  rawUrl: string,
  fetchImpl: FetchLike = pinnedFetchLike
): Promise<FetchedText> {
  let current = rawUrl
  let res: Response | null = null
  let finalUrl = rawUrl

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicHttpsUrl(current)
    let r: Response
    try {
      r = await fetchImpl(url.href, {
        redirect: 'manual',
        headers: {
          'User-Agent': 'GAVEL-source-fetch/1.0',
          Accept: 'text/plain, text/html, text/markdown, application/json;q=0.9, */*;q=0.1',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new SourceFetchError(`request failed: ${msg}`, 504)
    }

    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location')
      if (!loc) throw new SourceFetchError(`redirect without a Location header (HTTP ${r.status})`, 502)
      try {
        current = new URL(loc, url.href).href
      } catch {
        throw new SourceFetchError('redirect target is not a valid URL', 502)
      }
      continue
    }
    if (!r.ok) {
      throw new SourceFetchError(`source responded with HTTP ${r.status}`, r.status === 404 ? 404 : 502)
    }
    res = r
    finalUrl = url.href
    break
  }
  if (!res) {
    throw new SourceFetchError(`too many redirects (more than ${MAX_REDIRECTS})`, 508)
  }

  if (!isTextualContentType(res.headers.get('content-type'))) {
    throw new SourceFetchError(
      `unsupported content type "${res.headers.get('content-type')}" — only text sources can be imported (convert PDFs/DOCX to text first)`,
      415
    )
  }

  let body = await readCapped(res)
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('text/html')) {
    body = htmlToText(body)
    if (body.length === 0) {
      throw new SourceFetchError('the page rendered no extractable text (JS-only app?)', 422)
    }
  }
  return { text: body, contentType: ct || null, bytes: Buffer.byteLength(body, 'utf8'), finalUrl }
}

// ───────────────────────── GitHub file fetch ─────────────────────────

export interface GithubFileRequest {
  owner: string
  repo: string
  /** Repo-relative path, e.g. "docs/sow.md". */
  path: string
  /** Branch / tag / sha. Omit = repo default branch. */
  ref?: string
  /** Optional PAT — public repos work without one (60 req/h). */
  token?: string
}

/**
 * Fetch a single file's content from a GitHub repository via the contents
 * API (raw media type). Errors map to the same human messages the
 * connector sync uses, since the failure modes are identical.
 */
export async function fetchTextFromGithub(
  req: GithubFileRequest,
  fetchImpl: FetchLike = pinnedFetchLike
): Promise<FetchedText> {
  if (req.path.startsWith('/') || req.path.split('/').includes('..')) {
    throw new SourceFetchError('path must be repo-relative and cannot contain ".." segments', 400)
  }
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.raw+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'GAVEL-source-fetch/1.0',
  }
  if (req.token) headers.Authorization = `Bearer ${req.token}`

  const q = req.ref ? `?ref=${encodeURIComponent(req.ref)}` : ''
  const url = `${GH_API}/repos/${encodeURIComponent(req.owner)}/${encodeURIComponent(req.repo)}/contents/${req.path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}${q}`

  let res: Response
  try {
    res = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new SourceFetchError(`GitHub request failed: ${msg}`, 504)
  }

  if (res.status === 401 || res.status === 403) {
    const remaining = res.headers.get('x-ratelimit-remaining')
    if (remaining === '0') {
      throw new SourceFetchError(
        'GitHub rate limit exhausted — add a personal access token (raises the budget to 5,000 req/h) or retry later',
        429
      )
    }
    throw new SourceFetchError(
      res.status === 401
        ? 'GitHub rejected the token (401) — check that it is valid'
        : 'GitHub refused access (403) — the token may lack scope for this repository, or the repo is private and no token was given',
      res.status
    )
  }
  if (res.status === 404) {
    throw new SourceFetchError(
      'GitHub returned 404 — check owner/repo/path (and that the repo is public, or add a token for private access)',
      404
    )
  }
  if (!res.ok) {
    throw new SourceFetchError(`GitHub API error (HTTP ${res.status})`, 502)
  }

  // With the raw media type, directories still come back as a JSON array.
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) {
    const probe = await readCapped(res)
    let parsed: unknown
    try {
      parsed = JSON.parse(probe)
    } catch {
      parsed = null
    }
    if (Array.isArray(parsed)) {
      throw new SourceFetchError('that path is a directory — point at a single file (e.g. docs/sow.md)', 400)
    }
    // Odd, but some responses wrap content base64 — surface it as text.
    return { text: probe, contentType: ct, bytes: Buffer.byteLength(probe, 'utf8'), finalUrl: url }
  }

  const body = await readCapped(res)
  if (body.trim().length === 0) {
    throw new SourceFetchError('the file is empty', 422)
  }
  return { text: body, contentType: ct || null, bytes: Buffer.byteLength(body, 'utf8'), finalUrl: url }
}
