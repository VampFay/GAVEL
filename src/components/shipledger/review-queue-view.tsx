'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useAppStore } from '@/stores/app-store'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  FileText,
  ArrowRight,
  Filter,
  RotateCw,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  formatINRCompact, findingTypeLabel,
  statusColor, assessmentLabel, recommendedActionLabel,
  formatDate,
} from '@/lib/shipledger'
import { apiGet, apiPatch } from '@/lib/fetch'
import { Stamp } from './stamp'

interface Finding {
  id: string
  type: string
  title: string
  summary: string
  impactAmount: number | null
  confidence: string
  confidenceScore: number | null
  assessment: string
  recommendedAction: string
  status: string
  contractClause: string | null
  billingState: string | null
  reviewNotes: string | null
  reviewedAt: string | null
  createdAt: string
  // NOTE: the LIST endpoint (/api/findings) does not return `project`,
  // `contract`, or `evidence` — only the detail endpoint does. Kept optional
  // so the types match the actual wire format (this mismatch crashed the
  // queue in the browser until it was caught by live-render verification).
  project?: { id: string; name: string } | null
  contract?: { id: string; title: string } | null
  evidence?: Array<{
    id: string
    evidenceType: string
    source: string
    refId: string | null
    title: string
    detail: string | null
    timestamp: string | null
    weight: number | null
  }> | null
}

type Tab = 'pending_review' | 'approved' | 'dismissed' | 'escalated' | 'all'

export function ReviewQueueView() {
  const { openFinding } = useAppStore()
  const [findings, setFindings] = useState<Finding[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('pending_review')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    const { data: d, error: e } = await apiGet<{ findings: Finding[] }>('/api/findings', ctrl.signal)
    if (e) {
      setError(e.message)
      toast.error('Failed to load findings', { description: e.message })
    } else if (d) {
      setFindings(d.findings)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    return () => abortRef.current?.abort()
  }, [load])

  const takeAction = async (id: string, action: 'approve' | 'dismiss' | 'escalate') => {
    setActionLoading(id)
    const { data: d, error: e } = await apiPatch<{ finding: Finding }>(`/api/findings/${id}`, {
      action,
      // No `actor` body field — the route derives identity from the
      // request context (see src/lib/actor.ts).
    })
    if (e) {
      toast.error('Action failed', { description: e.message })
    } else if (d) {
      toast.success(`Finding ${action}d`, {
        description: action === 'approve'
          ? 'Moved to approved — eligible for billing.'
          : action === 'dismiss'
            ? 'Marked as dismissed — excluded from case file.'
            : 'Escalated to senior review.',
      })
      load()
    }
    setActionLoading(null)
  }

  if (loading || !findings) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-3" aria-busy="true">
        <Skeleton className="h-12 w-full" />
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <Card className="border-rose-200 dark:border-rose-900">
          <CardContent className="p-8 text-center">
            <div className="h-12 w-12 mx-auto rounded-full bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 flex items-center justify-center mb-3">
              <AlertCircle className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium">Couldn&apos;t load findings</p>
            <p className="text-xs text-muted-foreground mt-1">{error}</p>
            <Button variant="outline" size="sm" onClick={load} className="mt-3">
              <RotateCw className="h-3.5 w-3.5 mr-1.5" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const filtered = tab === 'all' ? findings : findings.filter(f => f.status === tab)
  const totalImpact = findings.filter(f => f.status !== 'dismissed').reduce((s, f) => s + (f.impactAmount ?? 0), 0)

  const counts = {
    pending_review: findings.filter(f => f.status === 'pending_review').length,
    approved: findings.filter(f => f.status === 'approved').length,
    dismissed: findings.filter(f => f.status === 'dismissed').length,
    escalated: findings.filter(f => f.status === 'escalated').length,
    all: findings.length,
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Triage header — stats only; the section title lives in the context bar */}
      <div className="mb-4 flex items-center gap-4 flex-wrap border-b border-border pb-3">
        <div className="num text-sm">
          <span className="font-semibold text-primary">{counts.pending_review}</span>
          <span className="text-muted-foreground"> pending review</span>
        </div>
        <div className="h-3 w-px bg-border hidden sm:block" />
        <div className="num text-sm">
          <span className="font-semibold">{formatINRCompact(totalImpact)}</span>
          <span className="text-muted-foreground"> total identified</span>
        </div>
        <div className="ml-auto text-[11px] text-muted-foreground italic hidden sm:block">
          the product proposes, humans assert
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mb-4">
        <TabsList>
          <TabsTrigger value="pending_review" className="text-xs">
            Pending ({counts.pending_review})
          </TabsTrigger>
          <TabsTrigger value="approved" className="text-xs">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Approved ({counts.approved})
          </TabsTrigger>
          <TabsTrigger value="dismissed" className="text-xs">
            <XCircle className="h-3 w-3 mr-1" />
            Dismissed ({counts.dismissed})
          </TabsTrigger>
          <TabsTrigger value="escalated" className="text-xs">
            <AlertCircle className="h-3 w-3 mr-1" />
            Escalated ({counts.escalated})
          </TabsTrigger>
          <TabsTrigger value="all" className="text-xs">
            All ({counts.all})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {filtered.length === 0 && (
        <div className="border border-dashed rounded-md">
          <div className="p-10 text-center">
            <div className="h-10 w-10 rounded-full bg-muted text-muted-foreground flex items-center justify-center mx-auto mb-3">
              <Filter className="h-4 w-4" />
            </div>
            <p className="text-sm text-muted-foreground">No findings in this state.</p>
          </div>
        </div>
      )}

      {/* Ledger — divided rows, one finding per entry; riffles in like a
          stack being dealt, each row hover-lifts, verdicts land as stamps */}
      <div className="divide-y divide-border stagger-fast">
        {filtered.map(f => (
          <FindingRow
            key={f.id}
            finding={f}
            onAction={takeAction}
            actionLoading={actionLoading === f.id}
            onOpen={() => openFinding(f.id)}
          />
        ))}
      </div>
    </div>
  )
}

/* Status spine: the row's left ink marks where the finding sits in the
   review lifecycle — pending=amber, approved=emerald, dismissed=stone,
   escalated=rose. */
const STATUS_SPINE: Record<string, string> = {
  pending_review: 'border-l-amber-500',
  approved: 'border-l-emerald-600',
  dismissed: 'border-l-stone-400',
  escalated: 'border-l-rose-500',
}

/* 4-segment confidence meter — filled segments track the score band. */
function ConfidenceMeter({ score, label }: { score: number | null; label: string }) {
  const pct = score == null ? 0 : Math.round(score * 100)
  const filled = score == null ? 0 : pct >= 85 ? 4 : pct >= 70 ? 3 : pct >= 50 ? 2 : 1
  const ink = label === 'high' ? 'bg-emerald-600' : label === 'medium' ? 'bg-amber-500' : 'bg-rose-500'
  return (
    <span className="inline-flex items-center gap-1.5" title={`Confidence ${label} · ${score != null ? pct + '%' : 'unscored'}`}>
      <span className="flex gap-[2px]" aria-hidden="true">
        {[0, 1, 2, 3].map(i => (
          <span key={i} className={cn('h-2.5 w-1 rounded-[1px]', i < filled ? ink : 'bg-border')} />
        ))}
      </span>
      <span className="num text-[10px] text-muted-foreground">{score != null ? pct + '%' : '—'}</span>
    </span>
  )
}

function FindingRow({
  finding, onAction, actionLoading, onOpen,
}: {
  finding: Finding
  onAction: (id: string, action: 'approve' | 'dismiss' | 'escalate') => void
  actionLoading: boolean
  onOpen: () => void
}) {
  const stat = statusColor(finding.status)
  const isPending = finding.status === 'pending_review'

  return (
    <article className={cn('relative ledger-row border-l-[3px] py-4 pl-4 pr-1 md:pl-5', STATUS_SPINE[finding.status] ?? 'border-l-stone-400')}>
      {/* Head line: type · status · confidence · assessment · impact */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <Badge variant="outline" className="text-[10px] font-semibold">{findingTypeLabel(finding.type)}</Badge>
          {isPending ? (
            <Badge variant="outline" className={cn('text-[10px]', stat.bg, stat.text, stat.border)}>
              {finding.status.replace('_', ' ')}
            </Badge>
          ) : (
            <Stamp status={finding.status} className="-my-1" />
          )}
          <ConfidenceMeter score={finding.confidenceScore} label={finding.confidence} />
          <span className="text-[11px] text-muted-foreground hidden lg:inline">{assessmentLabel(finding.assessment)}</span>
          {finding.project && (
            <span className="text-[11px] text-muted-foreground hidden xl:inline truncate">
              <span className="text-border mx-1">·</span>{finding.project.name}
            </span>
          )}
        </div>
        <div className="text-right shrink-0" aria-label="Impact amount">
          <div className="num text-xl font-semibold text-foreground leading-none">{formatINRCompact(finding.impactAmount)}</div>
          <div className="micro mt-1">impact</div>
        </div>
      </div>

      {/* Body: title + summary — clickable, opens the case file */}
      <button onClick={onOpen} className="mt-2 block w-full text-left group" aria-label={`Open case file: ${finding.title}`}>
        <h3 className="text-[13px] font-semibold leading-snug group-hover:text-primary transition-colors">{finding.title}</h3>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed line-clamp-2">{finding.summary}</p>
      </button>

      {/* Anatomy strip — the case-file skeleton */}
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px]">
        <AnatomyCell label="Baseline" value={finding.contractClause} />
        <AnatomyCell label="Billing" value={finding.billingState} />
        <AnatomyCell label="Recommended" value={recommendedActionLabel(finding.recommendedAction)} />
        <AnatomyCell label="Reviewed" value={finding.reviewedAt ? formatDate(finding.reviewedAt) : null} mono />
      </div>

      {/* Evidence chips — the list endpoint may omit evidence entirely (it is
          only guaranteed on the detail route), so every access is null-safe */}
      {(finding.evidence?.length ?? 0) > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="micro mr-0.5">Evidence {finding.evidence?.length}</span>
            {(finding.evidence ?? []).slice(0, 4).map(e => (
              <button
                key={e.id}
                onClick={onOpen}
                title={`${e.title}${e.detail ? ` — ${e.detail}` : ''}`}
                className="inline-flex max-w-[220px] items-center gap-1 rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 hover:border-primary/40 hover:bg-muted/70 transition-colors"
              >
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-[1px]',
                  e.source === 'contract' ? 'bg-emerald-600'
                  : e.source === 'invoice' ? 'bg-amber-500'
                  : e.source === 'jira' || e.source === 'github' ? 'bg-rose-500'
                  : 'bg-stone-400')} />
                <span className="text-[10px] truncate">{e.title}</span>
              </button>
            ))}
          </div>
        )}

        {/* Actions + notes */}
        <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={onOpen} className="h-7 px-2 text-primary text-xs">
            <FileText className="h-3 w-3 mr-1" />
            Open case file
            <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
          {isPending && (
            <div className="flex gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={actionLoading}
                  >
                    <XCircle className="h-3.5 w-3.5 mr-1" />
                    Dismiss
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Dismiss this finding?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Dismissing removes the finding from the case file and excludes it from the total impact calculation. This action is logged to the audit trail and cannot be undone from the UI.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => onAction(finding.id, 'dismiss')}
                      className="bg-muted text-foreground hover:bg-muted/80"
                    >
                      Yes, dismiss
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={actionLoading}
                    className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/30"
                  >
                    <AlertCircle className="h-3.5 w-3.5 mr-1" />
                    Escalate
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Escalate to senior review?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Escalated findings are flagged for a senior reviewer to make the final call. The decision will be logged.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => onAction(finding.id, 'escalate')}
                      className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:text-amber-300"
                    >
                      Escalate
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    disabled={actionLoading}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                    Approve &amp; bill
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Approve &amp; bill this finding?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Approving marks this finding as billable and includes its impact ({formatINRCompact(finding.impactAmount)}) in the approved-impact total. The decision is logged to the immutable audit trail.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => onAction(finding.id, 'approve')}
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      Approve &amp; bill
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
          {!isPending && finding.reviewNotes && (
            <div className="text-xs text-muted-foreground italic max-w-md">
              &ldquo;{finding.reviewNotes}&rdquo;
            </div>
          )}
        </div>
    </article>
  )
}

function AnatomyCell({ label, value, mono = false }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 min-w-0">
      <span className="micro">{label}</span>
      <span className={cn('text-[11px] leading-snug text-foreground/80 truncate max-w-[280px]', mono && 'num')}>{value ?? '—'}</span>
    </span>
  )
}
