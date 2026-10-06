// GAVEL — GitHub connector (production blocker #4).
//
// Pulls commits (and optionally merged PRs) from a repository via the
// public REST API and maps them to MappedCodeActivity — the same shape
// the github-commits CSV upload produces. Re-uploads/syncs dedupe on the
// commit sha / PR number exactly like the CSV path (commit layer, shared).
//
// Auth: a personal access token (classic with `repo`/`read:public_key`
// scopes, or fine-grained with Contents: read) when the repo is private;
// token-less access works for public repos within GitHub's 60 req/h
// unauthenticated budget (documented in the sync summary when hit).
//
// Design choices:
//   - pagination capped at 10 pages × 100 records = 1,000 records per kind
//     per sync — the same order of magnitude as the CSV path's 2,500-row
//     cap, and deliberately far away from anything that would look like a
//     scrape. The `since` window (config.days) bounds the pull further.
//   - per-commit stats (additions/deletions) would cost one extra API call
//     PER COMMIT — they stay null (the mapper treats them as optional).
//   - fetchImpl is injectable so unit tests never touch the network.

import type { MappedCodeActivity } from '@/lib/ingest/mappers'
import { ConnectorError, type GithubConfig, type GithubCredentials } from './types'
import { pinnedFetch } from '@/lib/net/pinned-fetch'

const API = 'https://api.github.com'
const PER_PAGE = 100
const MAX_PAGES = 10
const TIMEOUT_MS = 20_000

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** WP 1.3: DNS-pinned transport by default (resolve once → validate → dial). */
const pinnedFetchLike: FetchLike = (url, init = {}) =>
  pinnedFetch(url, {
    method: init.method,
    headers: init.headers as Record<string, string> | undefined,
    body: init.body as string | Buffer | Uint8Array | undefined,
    signal: init.signal ?? undefined,
  })

interface GhCommit {
  sha: string
  html_url?: string
  commit?: {
    message?: string
    author?: { name?: string; date?: string }
  }
  author?: { login?: string } | null
}

interface GhPull {
  number: number
  title?: string
  html_url?: string
  user?: { login?: string } | null
  merged_at?: string | null
  created_at?: string
}

function headers(creds: GithubCredentials): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'GAVEL-connector/1.0',
  }
  if (creds.token) h.Authorization = `Bearer ${creds.token}`
  return h
}

async function ghFetch(
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike
): Promise<Response> {
  let res: Response
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new ConnectorError(`GitHub request failed: ${msg}`, 504)
  }
  if (res.status === 401 || res.status === 403) {
    const remaining = res.headers.get('x-ratelimit-remaining')
    if (remaining === '0') {
      throw new ConnectorError(
        'GitHub rate limit exhausted — add a personal access token to the connector config (raises the budget to 5,000 req/h)',
        429
      )
    }
    throw new ConnectorError(
      res.status === 401
        ? 'GitHub rejected the token (401) — check that it is valid and has read access to this repository'
        : 'GitHub refused access (403) — the token may lack scope for this repository',
      res.status
    )
  }
  if (res.status === 404) {
    throw new ConnectorError('GitHub repository not found — check owner/repo (and token access for private repos)', 404)
  }
  if (!res.ok) {
    throw new ConnectorError(`GitHub API error (HTTP ${res.status})`, 502)
  }
  return res
}

function firstLine(message: string | undefined): string {
  if (!message) return '(no commit message)'
  const line = message.split('\n')[0] ?? message
  return line.length > 500 ? line.slice(0, 497) + '…' : line
}

function mapCommits(rows: GhCommit[]): MappedCodeActivity[] {
  return rows.map(c => ({
    type: 'commit',
    ref: c.sha,
    title: firstLine(c.commit?.message),
    author: c.commit?.author?.name ?? c.author?.login ?? 'unknown',
    timestamp: c.commit?.author?.date ? new Date(c.commit.author.date) : new Date(0),
    additions: null,
    deletions: null,
    filesChanged: null,
    url: c.html_url ?? null,
  }))
}

function mapPulls(rows: GhPull[]): MappedCodeActivity[] {
  return rows.map(p => ({
    type: 'pr',
    ref: String(p.number),
    title: (p.title ?? `(PR #${p.number})`).slice(0, 500),
    author: p.user?.login ?? 'unknown',
    timestamp: new Date(p.merged_at ?? p.created_at ?? 0),
    additions: null,
    deletions: null,
    filesChanged: null,
    url: p.html_url ?? null,
  }))
}

/**
 * Fetch commits + PRs for a repo since `config.days` days ago.
 * Returns normalized activities plus sync metadata.
 */
export async function fetchGithubActivities(
  config: GithubConfig,
  creds: GithubCredentials,
  fetchImpl: FetchLike = pinnedFetchLike
): Promise<{ activities: MappedCodeActivity[]; apiCalls: number; truncated: boolean }> {
  const since = new Date(Date.now() - config.days * 24 * 60 * 60_000).toISOString()
  const base = `${API}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`
  const hdr = { headers: headers(creds) }

  let apiCalls = 0
  let truncated = false
  const activities: MappedCodeActivity[] = []

  // ── Commits ─────────────────────────────────────────────────────────
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await ghFetch(`${base}/commits?per_page=${PER_PAGE}&page=${page}&since=${since}`, hdr, fetchImpl)
    apiCalls++
    const rows = (await res.json()) as GhCommit[]
    if (!Array.isArray(rows) || rows.length === 0) break
    activities.push(...mapCommits(rows))
    if (rows.length < PER_PAGE) break
    if (page === MAX_PAGES) truncated = true
  }

  // ── Pull requests (optional) ────────────────────────────────────────
  if (config.includePrs) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await ghFetch(`${base}/pulls?state=all&per_page=${PER_PAGE}&page=${page}&sort=created&direction=desc`, hdr, fetchImpl)
      apiCalls++
      const rows = (await res.json()) as GhPull[]
      if (!Array.isArray(rows) || rows.length === 0) break
      // Keep only PRs inside the window (created OR merged within it).
      const cutoff = Date.now() - config.days * 24 * 60 * 60_000
      const inWindow = rows.filter(p => {
        const t = p.merged_at ?? p.created_at
        return !t || new Date(t).getTime() >= cutoff // undated → keep, let dedupe handle it
      })
      activities.push(...mapPulls(inWindow))
      if (rows.length < PER_PAGE) break
      if (page === MAX_PAGES) truncated = true
    }
  }

  return { activities, apiCalls, truncated }
}
