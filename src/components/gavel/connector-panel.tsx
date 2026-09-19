'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Github, KanbanSquare, Loader2, RefreshCw, Trash2, CheckCircle2,
  Plug, Lock,
} from 'lucide-react'
import { toast } from 'sonner'
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/fetch'
import { cn } from '@/lib/utils'

/**
 * Live connector panel — the "attach GitHub / Jira" answer.
 *
 * Rendered inside the intake modal's Evidence step (and usable anywhere a
 * clientId is known). Flow:
 *   1. pick the source (GitHub repo / Jira site)
 *   2. save config + credentials (sealed server-side with AES-256-GCM —
 *      the token never comes back to the browser after this call)
 *   3. Sync now → pulls records through the same ingestion pipeline as a
 *      CSV upload (idempotent: re-syncs update, never duplicate)
 *
 * GitHub public repos work without a token (60 req/h); private repos and
 * Jira always need credentials.
 */

type Kind = 'github' | 'jira'

interface ConnectorRow {
  id: string
  kind: string
  config: Record<string, unknown>
  projectId: string
  hasCredentials: boolean
  lastSyncAt: string | null
  lastSyncStatus: string | null
  lastSyncSummary: string | null
}

interface SyncResult {
  kind: string
  project: string
  fetched: { tickets?: number; codeActivities?: number; apiCalls: number; truncated: boolean }
  committed: {
    ticketsCreated: number
    ticketsUpdated: number
    activitiesCreated: number
    duplicates: number
    hint?: string
  }
}

export function ConnectorPanel({ clientId }: { clientId: string }) {
  const [connectors, setConnectors] = useState<ConnectorRow[]>([])
  const [loading, setLoading] = useState(true)
  const [kind, setKind] = useState<Kind>('github')

  // github fields
  const [owner, setOwner] = useState('')
  const [repo, setRepo] = useState('')
  const [ghToken, setGhToken] = useState('')
  const [includePrs, setIncludePrs] = useState(true)
  const [days, setDays] = useState(90)

  // jira fields
  const [host, setHost] = useState('')
  const [jql, setJql] = useState('')
  const [jiraEmail, setJiraEmail] = useState('')
  const [jiraToken, setJiraToken] = useState('')

  const [busy, setBusy] = useState<'save' | 'sync' | `sync:${string}` | null>(null)
  const [lastResult, setLastResult] = useState<SyncResult | null>(null)

  async function refresh() {
    setLoading(true)
    const { data, error } = await apiGet<{ connectors: ConnectorRow[] }>(`/api/connectors?clientId=${encodeURIComponent(clientId)}`)
    if (error) {
      // 403 = viewer/reviewer opening the panel — surface quietly.
      if (error.status !== 403 && error.status !== 401) {
        toast.error('Could not load connectors', { description: error.message })
      }
      setConnectors([])
    } else {
      setConnectors(data?.connectors ?? [])
    }
    setLoading(false)
  }

  useEffect(() => { void refresh() }, [clientId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setBusy('save')
    const body =
      kind === 'github'
        ? {
            clientId, kind,
            config: { owner, repo, includePrs, days },
            ...(ghToken ? { credentials: { token: ghToken } } : {}),
          }
        : {
            clientId, kind,
            config: { host, jql: jql || undefined },
            credentials: { email: jiraEmail, apiToken: jiraToken },
          }
    const { data, error } = await apiPut<{ connector: ConnectorRow }>('/api/connectors', body)
    setBusy(null)
    if (error || !data) {
      toast.error('Could not save connector', { description: error?.message ?? 'unknown error' })
      return
    }
    toast.success(`${kind === 'github' ? 'GitHub' : 'Jira'} connector saved`, {
      description: 'Credentials are sealed (AES-256-GCM) — they never leave the server unencrypted again.',
    })
    setGhToken('')
    setJiraToken('')
    void refresh()
  }

  async function sync(id: string) {
    setBusy(`sync:${id}`)
    setLastResult(null)
    const { data, error } = await apiPost<SyncResult>(`/api/connectors/${id}/sync`, {})
    setBusy(null)
    if (error || !data) {
      toast.error('Sync failed', { description: error?.message ?? 'unknown error' })
      return
    }
    setLastResult(data)
    const c = data.committed
    const imported =
      data.kind === 'jira'
        ? `${c.ticketsCreated} new + ${c.ticketsUpdated} updated tickets`
        : `${c.activitiesCreated} new activities (${c.duplicates} already known)`
    toast.success('Sync complete', { description: imported })
    void refresh()
  }

  async function remove(id: string) {
    const { error } = await apiDelete(`/api/connectors?id=${id}`)
    if (error) {
      toast.error('Could not remove connector', { description: error.message })
      return
    }
    toast.success('Connector removed')
    void refresh()
  }

  const saveDisabled =
    busy !== null ||
    (kind === 'github'
      ? !owner.trim() || !repo.trim()
      : !host.trim() || !jiraEmail.trim() || !jiraToken.trim())

  return (
    <div>
      <div className="flex items-center gap-2">
        <Plug className="h-3.5 w-3.5 text-primary" />
        <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Live connectors
        </h4>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Pull delivery evidence straight from GitHub or Jira — no CSV export needed. Records land in the
        same ingestion pipeline and re-syncs never duplicate.
      </p>

      {/* ── Saved connectors ───────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      ) : connectors.length > 0 && (
        <div className="mt-3 space-y-2">
          {connectors.map(c => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 rounded border bg-card p-2.5">
              {c.kind === 'github'
                ? <Github className="h-3.5 w-3.5 shrink-0" />
                : <KanbanSquare className="h-3.5 w-3.5 shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="num truncate text-xs font-medium">
                    {c.kind === 'github'
                      ? `${c.config.owner}/${c.config.repo}`
                      : String(c.config.host)}
                  </span>
                  {c.hasCredentials && (
                    <Badge variant="outline" className="gap-0.5 text-[9px]"><Lock className="h-2.5 w-2.5" /> sealed</Badge>
                  )}
                </div>
                {c.lastSyncAt ? (
                  <p className="num mt-0.5 text-[10px] text-muted-foreground/80">
                    last sync {new Date(c.lastSyncAt).toLocaleString()}
                    {c.lastSyncSummary ? ` — ${c.lastSyncSummary}` : ''}
                  </p>
                ) : (
                  <p className="num mt-0.5 text-[10px] text-muted-foreground/60">never synced</p>
                )}
              </div>
              <Button variant="outline" size="sm" disabled={busy !== null}
                onClick={() => void sync(c.id)}>
                {busy === `sync:${c.id}`
                  ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  : <RefreshCw className="mr-1 h-3 w-3" />}
                Sync
              </Button>
              <Button variant="ghost" size="sm" disabled={busy !== null}
                onClick={() => void remove(c.id)} title="Remove connector">
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {lastResult && (
        <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 p-2.5 text-xs dark:border-emerald-900 dark:bg-emerald-950/40">
          <p className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" /> Imported into “{lastResult.project}”
          </p>
          <p className="num mt-0.5 text-emerald-700/80 dark:text-emerald-400/80">
            {lastResult.kind === 'jira'
              ? `${lastResult.committed.ticketsCreated} tickets created · ${lastResult.committed.ticketsUpdated} updated`
              : `${lastResult.committed.activitiesCreated} code activities added · ${lastResult.committed.duplicates} duplicates skipped`}
            {' '}(upstream API calls: {lastResult.fetched.apiCalls})
          </p>
        </div>
      )}

      <Separator className="my-3" />

      {/* ── Kind picker ────────────────────────────────────────────── */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        {(['github', 'jira'] as const).map(k => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={cn(
              'flex items-center gap-1.5 rounded border p-2 text-left text-xs transition-colors',
              kind === k ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
            )}
          >
            {k === 'github' ? <Github className="h-3.5 w-3.5" /> : <KanbanSquare className="h-3.5 w-3.5" />}
            {k === 'github' ? 'GitHub' : 'Jira'}
          </button>
        ))}
      </div>

      {kind === 'github' ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="gh-owner" className="micro">Owner / org</Label>
            <Input id="gh-owner" placeholder="veridian-health" value={owner}
              onChange={e => setOwner(e.target.value)} className="num text-xs" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="gh-repo" className="micro">Repository</Label>
            <Input id="gh-repo" placeholder="patient-portal" value={repo}
              onChange={e => setRepo(e.target.value)} className="num text-xs" />
          </div>
          <div className="col-span-2 space-y-1">
            <Label htmlFor="gh-token" className="micro">
              Personal access token <span className="normal-case text-muted-foreground/60">(optional — public repos work without)</span>
            </Label>
            <Input id="gh-token" type="password" placeholder="ghp_… (stored sealed, never shown again)"
              value={ghToken} onChange={e => setGhToken(e.target.value)} className="num text-xs" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="gh-days" className="micro">Look-back (days)</Label>
            <Input id="gh-days" type="number" min={1} max={365} value={days}
              onChange={e => setDays(Number(e.target.value) || 90)} className="num text-xs" />
          </div>
          <label className="flex items-end gap-1.5 pb-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={includePrs} onChange={e => setIncludePrs(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--primary)]" />
            include pull requests
          </label>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor="jira-host" className="micro">Site host</Label>
            <Input id="jira-host" placeholder="acme.atlassian.net" value={host}
              onChange={e => setHost(e.target.value)} className="num text-xs" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="jira-jql" className="micro">
              JQL filter <span className="normal-case text-muted-foreground/60">(optional)</span>
            </Label>
            <Input id="jira-jql" placeholder="project = ENG AND updated >= -90d" value={jql}
              onChange={e => setJql(e.target.value)} className="num text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="jira-email" className="micro">Account email</Label>
              <Input id="jira-email" type="email" placeholder="you@acme.com" value={jiraEmail}
                onChange={e => setJiraEmail(e.target.value)} className="num text-xs" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="jira-token" className="micro">API token</Label>
              <Input id="jira-token" type="password" placeholder="sealed on save" value={jiraToken}
                onChange={e => setJiraToken(e.target.value)} className="num text-xs" />
            </div>
          </div>
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3 w-full"
        disabled={saveDisabled}
        onClick={() => void save()}
      >
        {busy === 'save' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
        Save {kind === 'github' ? 'GitHub' : 'Jira'} connector
      </Button>
      <p className="num mt-1.5 text-[10px] text-muted-foreground/60">
        Create the token at github.com/settings/tokens (Contents: read) or
        id.atlassian.com/manage-profile/security/api-tokens.
      </p>
    </div>
  )
}
