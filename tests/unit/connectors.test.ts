import { describe, it, expect, vi } from 'vitest'
import { fetchGithubActivities } from '../../src/lib/connectors/github'
import { fetchJiraTickets, adfToText } from '../../src/lib/connectors/jira'
import { GithubConfigSchema, JiraConfigSchema } from '../../src/lib/connectors/types'

// ── GitHub ──────────────────────────────────────────────────────────────────

const GH_COMMIT = {
  sha: 'abc123def456',
  html_url: 'https://github.com/acme/repo/commit/abc123def456',
  commit: {
    message: 'feat: patient SSO integration\n\nCo-authored-by: someone',
    author: { name: 'Aisha K', date: '2025-06-14T11:08:00Z' },
  },
  author: { login: 'aisha-k' },
}

// PR fixture with CURRENT-RELATIVE dates — the mapper filters PRs to the
// configured look-back window (90d default), so a fixed 2025 date would
// fall outside it whenever the wall clock moves on.
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60_000).toISOString()
const GH_PR = {
  number: 284,
  title: 'Telemedicine WebRTC integration',
  html_url: 'https://github.com/acme/repo/pull/284',
  user: { login: 'aisha-k' },
  merged_at: daysAgo(1),
  created_at: daysAgo(10),
}

function ghResponse(rows: unknown[], headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

describe('fetchGithubActivities', () => {
  const cfg = GithubConfigSchema.parse({ owner: 'acme', repo: 'repo', includePrs: true, days: 90 })

  it('maps commits + PRs to MappedCodeActivity', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async (url: string) => {
      calls++
      if (url.includes('/commits')) return ghResponse([GH_COMMIT])
      return ghResponse([GH_PR])
    })
    const { activities, apiCalls } = await fetchGithubActivities(cfg, {}, fetchImpl)
    expect(activities).toHaveLength(2)

    const commit = activities.find(a => a.type === 'commit')
    expect(commit).toMatchObject({
      ref: 'abc123def456',
      title: 'feat: patient SSO integration', // first line only
      author: 'Aisha K', // commit.author.name wins over login
      url: 'https://github.com/acme/repo/commit/abc123def456',
    })
    expect(commit?.timestamp.toISOString()).toBe('2025-06-14T11:08:00.000Z')

    const pr = activities.find(a => a.type === 'pr')
    expect(pr).toMatchObject({ ref: '284', author: 'aisha-k' })
    expect(apiCalls).toBe(2)
    expect(calls).toBe(2)
  })

  it('paginates with per_page=100 and stops on short pages', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const page = Number(/[?&]page=(\d+)/.exec(url)?.[1] ?? '1')
      if (url.includes('/commits')) {
        return ghResponse(page === 1 ? Array.from({ length: 100 }, (_, i) => ({ ...GH_COMMIT, sha: `s${i}` })) : [])
      }
      return ghResponse([])
    })
    const { activities } = await fetchGithubActivities(cfg, {}, fetchImpl)
    expect(activities.filter(a => a.type === 'commit')).toHaveLength(100)
  })

  it('maps a 404 to a friendly ConnectorError', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 404 }))
    await expect(fetchGithubActivities(cfg, {}, fetchImpl)).rejects.toThrow(/repository not found/)
  })

  it('maps rate-limit exhaustion (403 + remaining=0) to a token hint', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } })
    )
    await expect(fetchGithubActivities(cfg, {}, fetchImpl)).rejects.toThrow(/rate limit/)
  })

  it('maps a 401 to a bad-token error', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 }))
    await expect(fetchGithubActivities(cfg, {}, fetchImpl)).rejects.toThrow(/rejected the token/)
  })

  it('sends the Authorization header when a token is configured', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/commits')) {
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer ghp_test')
        return ghResponse([])
      }
      return ghResponse([])
    })
    await fetchGithubActivities(cfg, { token: 'ghp_test' }, fetchImpl)
    expect(fetchImpl).toHaveBeenCalled()
  })
})

// ── Jira ────────────────────────────────────────────────────────────────────

const JIRA_ISSUE = {
  key: 'ENG-131',
  fields: {
    summary: 'Telemedicine WebRTC SDK integration',
    issuetype: { name: 'Story' },
    status: { name: 'Done' },
    assignee: { displayName: 'Aisha K.' },
    created: '2025-06-02T10:00:00.000Z',
    updated: '2025-06-14T11:08:00.000Z',
    description: {
      type: 'doc',
      version: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Integrate the WebRTC SDK' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Third-party vendor: Twilio' }] },
      ],
    },
  },
}

describe('adfToText (Atlassian Document Format flattening)', () => {
  it('flattens nested ADF content to text', () => {
    const out = adfToText(JIRA_ISSUE.fields.description)
    expect(out).toContain('Integrate the WebRTC SDK')
    expect(out).toContain('Third-party vendor: Twilio')
  })
  it('handles null / scalars / deep nesting without throwing', () => {
    expect(adfToText(null)).toBe('')
    expect(adfToText('plain')).toBe('plain')
    expect(adfToText(42)).toBe('42')
    expect(typeof adfToText({ a: { b: { c: { d: [{ e: 'deep' }] } } } })).toBe('string')
  })
})

describe('fetchJiraTickets', () => {
  const cfg = JiraConfigSchema.parse({ host: 'acme.atlassian.net' })

  it('maps issues to MappedTicket', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://acme.atlassian.net/rest/api/3/search/jql')
      expect(init?.method).toBe('POST')
      const auth = (init?.headers as Record<string, string>).Authorization
      expect(auth).toBe(`Basic ${Buffer.from('a@b.c:tok').toString('base64')}`)
      return new Response(
        JSON.stringify({ issues: [JIRA_ISSUE], isLast: true }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })
    const { tickets, apiCalls } = await fetchJiraTickets(cfg, { email: 'a@b.c', apiToken: 'tok' }, fetchImpl)
    expect(tickets).toHaveLength(1)
    expect(tickets[0]).toMatchObject({
      externalId: 'ENG-131',
      title: 'Telemedicine WebRTC SDK integration',
      type: 'story',           // normalized from "Story"
      status: 'done',          // normalized from "Done"
      assignee: 'Aisha K.',
    })
    expect(tickets[0]?.description).toContain('WebRTC SDK')
    expect(apiCalls).toBe(1)
  })

  it('maps a 401 to a friendly ConnectorError', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 }))
    await expect(fetchJiraTickets(cfg, { email: 'a@b.c', apiToken: 'bad' }, fetchImpl))
      .rejects.toThrow(/rejected the credentials/)
  })

  it('maps a 400 to a JQL syntax error', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 400 }))
    await expect(fetchJiraTickets(cfg, { email: 'a@b.c', apiToken: 'tok' }, fetchImpl))
      .rejects.toThrow(/JQL/)
  })
})
