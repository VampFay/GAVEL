// GAVEL — Jira connector (production blocker #4).
//
// Pulls issues from a Jira Cloud instance via /rest/api/3/search/jql
// (the POST pagination endpoint — the old GET /search is deprecated by
// Atlassian) with Basic auth (account email + API token), and maps them
// to MappedTicket — the same shape the jira-tickets CSV upload produces.
//
// Scope control: `jql` in the connector config (e.g.
// `project = ENG AND updated >= -90d ORDER BY created DESC`). The default
// pulls everything the token can see — recommend a scoped token + JQL.
//
// ADF: Jira Cloud returns the description as Atlassian Document Format
// (a JSON tree). We flatten it to plain text (best-effort walk, capped)
// because the Ticket model stores a text description — the forensic
// narrative, not the formatting, is what the engine reads.
//
// fetchImpl is injectable so unit tests never touch the network.

import type { MappedTicket } from '@/lib/ingest/mappers'
import { ConnectorError, type JiraConfig, type JiraCredentials } from './types'

const TIMEOUT_MS = 20_000
const MAX_PAGES = 10
const MAX_RESULTS_PER_PAGE = 100
const DESCRIPTION_CAP = 10_000

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

interface JiraIssue {
  key?: string
  fields?: {
    summary?: string
    issuetype?: { name?: string }
    status?: { name?: string }
    assignee?: { displayName?: string; emailAddress?: string } | null
    created?: string
    updated?: string
    description?: unknown // ADF or null
  }
}

const KNOWN_TYPES: Record<string, string> = {
  story: 'story', task: 'task', bug: 'bug', epic: 'epic',
  subtask: 'subtask', 'sub-task': 'subtask', spike: 'spike', chore: 'chore',
}

function normalizeStatus(name: string | undefined): string {
  if (!name) return 'todo'
  const s = name.toLowerCase().replace(/\s+/g, '_')
  if (['done', 'closed', 'resolved', 'cancelled', 'canceled'].includes(s)) return 'done'
  if (['in_progress', 'indev', 'development', 'wip'].includes(s)) return 'in_progress'
  if (['todo', 'backlog', 'open', 'to_do'].includes(s)) return 'todo'
  return s
}

/** Flatten an Atlassian Document Format node into plain text (best-effort). */
export function adfToText(node: unknown, depth = 0): string {
  if (node === null || node === undefined || depth > 12) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number' || typeof node === 'boolean') return String(node)
  if (Array.isArray(node)) {
    return node.map(n => adfToText(n, depth + 1)).filter(Boolean).join('\n')
  }
  if (typeof node === 'object') {
    const n = node as { type?: string; text?: string; content?: unknown[] }
    const own = typeof n.text === 'string' ? n.text : ''
    const kids = Array.isArray(n.content) ? n.content.map(c => adfToText(c, depth + 1)).filter(Boolean).join('\n') : ''
    return [own, kids].filter(Boolean).join('\n')
  }
  return ''
}

function basicAuth(creds: JiraCredentials): string {
  return `Basic ${Buffer.from(`${creds.email}:${creds.apiToken}`).toString('base64')}`
}

async function jiraFetch(
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike
): Promise<Response> {
  let res: Response
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new ConnectorError(`Jira request failed: ${msg}`, 504)
  }
  if (res.status === 401) {
    throw new ConnectorError('Jira rejected the credentials (401) — check the account email and API token', 401)
  }
  if (res.status === 403) {
    throw new ConnectorError('Jira refused access (403) — the token may lack browse permissions for the project', 403)
  }
  if (res.status === 404) {
    throw new ConnectorError('Jira site not found — check the host (e.g. acme.atlassian.net)', 404)
  }
  if (res.status === 400) {
    throw new ConnectorError('Jira rejected the JQL — check the query syntax in the connector config', 400)
  }
  if (!res.ok) {
    throw new ConnectorError(`Jira API error (HTTP ${res.status})`, 502)
  }
  return res
}

function mapIssues(rows: JiraIssue[]): MappedTicket[] {
  return rows.map(i => {
    const f = i.fields ?? {}
    const rawType = f.issuetype?.name?.toLowerCase() ?? ''
    let description = adfToText(f.description)
    if (description.length > DESCRIPTION_CAP) description = description.slice(0, DESCRIPTION_CAP)
    return {
      externalId: i.key ?? '(no key)',
      title: (f.summary ?? '(no summary)').slice(0, 500),
      type: KNOWN_TYPES[rawType] ?? null,
      status: normalizeStatus(f.status?.name),
      assignee: f.assignee?.displayName ?? f.assignee?.emailAddress ?? null,
      externalCreated: f.created ? new Date(f.created) : null,
      externalUpdated: f.updated ? new Date(f.updated) : null,
      description: description || null,
    }
  })
}

/**
 * Fetch issues matching the configured JQL (default: everything visible).
 */
export async function fetchJiraTickets(
  config: JiraConfig,
  creds: JiraCredentials,
  fetchImpl: FetchLike = fetch
): Promise<{ tickets: MappedTicket[]; apiCalls: number; truncated: boolean }> {
  const url = `https://${config.host}/rest/api/3/search/jql`
  const init: RequestInit = {
    method: 'POST',
    headers: {
      Authorization: basicAuth(creds),
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jql: config.jql?.trim() || 'ORDER BY created DESC',
      maxResults: MAX_RESULTS_PER_PAGE,
      fields: ['summary', 'issuetype', 'status', 'assignee', 'created', 'updated', 'description'],
    }),
  }

  let apiCalls = 0
  let truncated = false
  const tickets: MappedTicket[] = []
  let pageToken: string | undefined

  for (let page = 1; page <= MAX_PAGES; page++) {
    const pageInit: RequestInit = { ...init }
    if (pageToken) {
      pageInit.body = JSON.stringify({
        jql: config.jql?.trim() || 'ORDER BY created DESC',
        maxResults: MAX_RESULTS_PER_PAGE,
        fields: ['summary', 'issuetype', 'status', 'assignee', 'created', 'updated', 'description'],
        nextPageToken: pageToken,
      })
    }
    const res = await jiraFetch(url, pageInit, fetchImpl)
    apiCalls++
    const body = (await res.json()) as { issues?: JiraIssue[]; nextPageToken?: string; isLast?: boolean }
    const rows = Array.isArray(body.issues) ? body.issues : []
    tickets.push(...mapIssues(rows))
    if (body.isLast !== false && !body.nextPageToken) break
    if (!body.nextPageToken) break
    pageToken = body.nextPageToken
    if (page === MAX_PAGES) truncated = true
  }

  return { tickets, apiCalls, truncated }
}
