'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useAppStore } from '@/stores/app-store'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  ArrowLeft, FileText, GitBranch, AlertTriangle,
  CheckCircle2, XCircle, AlertCircle, IndianRupee,
  Scale, Calendar, FileCheck2, RotateCw,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  formatINR, formatINRCompact, formatDateTime, formatDate, findingTypeLabel,
  statusColor, assessmentLabel, recommendedActionLabel,
  evidenceTypeLabel, sourceLabel,
} from '@/lib/gavel'
import { apiGet, apiPatch } from '@/lib/fetch'
import { cn } from '@/lib/utils'
import { CountUp } from './count-up'
import { Stamp } from './stamp'

interface FindingDetail {
  ok: boolean
  finding: {
    id: string
    type: string
    title: string
    summary: string
    impactAmount: number | null
    confidence: string
    confidenceScore: number | null
    // Per-pillar sub-scores computed by the engine (§9.4) — null on legacy
    // / manually-created findings, in which case we synthesize a fallback
    // from the evidence weights below.
    confidenceBreakdown: {
      contract: number
      delivery: number
      authorization: number
      billing: number
    } | null
    assessment: string
    recommendedAction: string
    status: string
    contractClause: string | null
    billingState: string | null
    reviewNotes: string | null
    reviewedAt: string | null
    createdAt: string
    project: { id: string; name: string; client?: { name: string } } | null
    contract: { id: string; title: string; totalValue: number | null; currency: string } | null
    evidence: Array<{
      id: string
      evidenceType: string
      source: string
      refId: string | null
      title: string
      detail: string | null
      timestamp: string | null
      weight: number | null
    }>
  }
}

export function FindingDetailView() {
  const { activeFindingId, setView, triggerVerdictFlash } = useAppStore()
  const [data, setData] = useState<FindingDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [notes, setNotes] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    if (!activeFindingId) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    const { data: d, error: e } = await apiGet<FindingDetail>(`/api/findings/${activeFindingId}`, ctrl.signal)
    if (e) {
      setError(e.message)
      toast.error('Failed to load finding', { description: e.message })
    } else if (d) {
      setData(d)
      setNotes(d.finding?.reviewNotes ?? '')
    }
    setLoading(false)
  }, [activeFindingId])

  useEffect(() => {
    load()
    return () => abortRef.current?.abort()
  }, [load])

  // Real export: builds the case file from the LIVE finding record (the
  // same data this view renders) and downloads it as JSON. Replaces a
  // dead "PDF export is on the roadmap" card with working actions.
  const downloadCaseFile = () => {
    if (!data?.finding) return
    const f = data.finding
    const caseFile = {
      exportedAt: new Date().toISOString(),
      finding: {
        id: f.id,
        type: f.type,
        title: f.title,
        summary: f.summary,
        impactAmount: f.impactAmount,
        currency: f.contract?.currency ?? 'INR',
        confidence: f.confidence,
        confidenceScore: f.confidenceScore,
        confidenceBreakdown: f.confidenceBreakdown,
        assessment: f.assessment,
        recommendedAction: f.recommendedAction,
        status: f.status,
        contractClause: f.contractClause,
        billingState: f.billingState,
        reviewNotes: f.reviewNotes,
        createdAt: f.createdAt,
        reviewedAt: f.reviewedAt,
      },
      client: f.project?.client?.name ?? null,
      project: f.project?.name ?? null,
      contract: f.contract ? { title: f.contract.title, totalValue: f.contract.totalValue } : null,
      evidence: f.evidence.map(e => ({
        evidenceType: e.evidenceType,
        source: e.source,
        refId: e.refId,
        title: e.title,
        detail: e.detail,
        timestamp: e.timestamp,
        weight: e.weight,
      })),
    }
    const blob = new Blob([JSON.stringify(caseFile, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `case-file-${f.type}-${f.id.slice(-8)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Case file exported', { description: `${f.evidence.length} evidence records included.` })
  }

  /* Map the review action to its stamped status for the verdict flash. */
  const FLASH_STATUS = {
    approve: 'approved',
    dismiss: 'dismissed',
    escalate: 'escalated',
  } as const

  const takeAction = async (action: 'approve' | 'dismiss' | 'escalate') => {
    if (!activeFindingId) return
    setActionLoading(true)
    const { data: d, error: e } = await apiPatch<FindingDetail>(`/api/findings/${activeFindingId}`, {
      action,
      reviewNotes: notes || undefined,
      // No `actor` body field — route derives identity from request context.
    })
    if (e) {
      toast.error('Action failed', { description: e.message })
    } else if (d) {
      // The ruling lands: stamp flash + table thud, then the toast.
      triggerVerdictFlash(FLASH_STATUS[action])
      toast.success(`Finding ${action}d`)
      load()
    }
    setActionLoading(false)
  }

  if (loading || !data) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-3" aria-busy="true">
        <Skeleton className="skeleton-ink h-12 w-full rounded-md" />
        <Skeleton className="skeleton-ink h-72 w-full rounded-md" />
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <Card className="border-rose-200 dark:border-rose-900">
          <CardContent className="p-8 text-center">
            <div className="h-12 w-12 mx-auto rounded-full bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 flex items-center justify-center mb-3">
              <AlertCircle className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium">Couldn&apos;t load finding</p>
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

  const f = data.finding
  const stat = statusColor(f.status)
  const isPending = f.status === 'pending_review'

  // Anatomy stages
  const stages = [
    { label: 'Commercial baseline', value: f.contractClause, icon: FileText },
    { label: 'Delivery evidence', value: f.evidence.filter(e => e.evidenceType === 'delivery_record').map(e => `${e.title} · ${formatDate(e.timestamp)}`).join('\n') || null, icon: GitBranch },
    { label: 'Billing state', value: f.billingState, icon: IndianRupee },
    { label: 'Assessment', value: assessmentLabel(f.assessment), icon: Scale },
    { label: 'Recommended action', value: recommendedActionLabel(f.recommendedAction), icon: AlertTriangle },
  ]

  // Confidence decomposition — §9.4 of the plan.
  // Preferred source: the engine-computed, DB-persisted breakdown
  // ("decomposed, not magical" — the sub-scores are computed where the
  // evidence is weighed, not reverse-engineered in the client).
  // Fallback for legacy / manually-created findings (no stored breakdown):
  // synthesize from the evidence weights so the panel still renders.
  const fallbackBreakdown = (() => {
    const contractClarity = f.evidence.find(e => e.evidenceType === 'contract_clause')?.weight ?? 0.3
    const deliveryStrength = f.evidence.filter(e => e.evidenceType === 'delivery_record').reduce((s, e) => s + (e.weight ?? 0), 0)
    const authorizationPresence = f.evidence.find(e => e.source === 'change_order')?.weight ?? 0.1
    const billingGapCertainty = f.evidence.find(e => e.evidenceType === 'billing_record')?.weight ?? 0.1
    return {
      contract: Math.min(contractClarity, 1),
      delivery: Math.min(deliveryStrength, 1),
      authorization: Math.min(authorizationPresence, 1),
      billing: Math.min(billingGapCertainty, 1),
    }
  })()
  const breakdown = f.confidenceBreakdown ?? fallbackBreakdown
  const usingStoredBreakdown = f.confidenceBreakdown != null
  const subScores = [
    { label: 'Contract clarity', value: breakdown.contract },
    { label: 'Delivery evidence', value: breakdown.delivery },
    { label: 'Authorization', value: breakdown.authorization },
    { label: 'Billing', value: breakdown.billing },
  ]

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="no-print">
        <Button variant="ghost" size="sm" onClick={() => setView('review_queue')} className="mb-4 -ml-2 text-muted-foreground">
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
          Back to review queue
        </Button>
      </div>

      {/* Case masthead */}
      <div className="border border-border rounded-md bg-card overflow-hidden mb-4">
        <div className="px-4 md:px-5 pt-4 pb-4 flex items-start justify-between gap-4 flex-wrap border-b border-border">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="outline" className="text-[10px] font-semibold">{findingTypeLabel(f.type)}</Badge>
              <Badge variant="outline" className={cn('text-[10px]', stat.bg, stat.text, stat.border)}>{f.status.replace('_', ' ')}</Badge>
              <span className="num text-[10px] text-muted-foreground/70 truncate">case {f.id.slice(-8)}</span>
            </div>
            <h1 className="text-lg font-semibold tracking-tight mt-2 leading-snug">{f.title}</h1>
            <p className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed max-w-3xl">{f.summary}</p>
          </div>
          <div className="text-right shrink-0">
            <CountUp
              value={f.impactAmount}
              format={n => formatINRCompact(n)}
              className="num text-3xl font-semibold text-primary leading-none"
            />
            <div className="micro mt-1">impact identified</div>
            <div className="num text-[10px] text-muted-foreground mt-1">contract: {formatINRCompact(f.contract?.totalValue)}</div>
            {!isPending && (
              <div className="mt-3 flex justify-end">
                <Stamp status={f.status} />
              </div>
            )}
          </div>
        </div>
        {/* Context rule: client · project · contract · detected */}
        <div className="px-4 md:px-5 py-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
          {f.project && (
            <span className="flex items-center gap-1 min-w-0">
              <FileCheck2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{f.project.client?.name ?? '—'} · {f.project.name}</span>
            </span>
          )}
          {f.contract && (
            <span className="flex items-center gap-1 min-w-0">
              <FileText className="h-3 w-3 shrink-0" />
              <span className="truncate">{f.contract.title}</span>
            </span>
          )}
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3 shrink-0" />
            <span className="num">detected {formatDate(f.createdAt)}</span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* LEFT: Evidence chain */}
        <div className="lg:col-span-2 space-y-4 stagger">
          <Panel title="Finding anatomy" sub="Baseline → delivery → billing → assessment → recommendation">
            <ol className="relative stagger-fast">
              {/* vertical spine — draws top-to-bottom like a ruling pen */}
              <div className="anim-timeline absolute left-3 top-2 bottom-2 w-px bg-border" aria-hidden />
              {stages.map((s, i) => {
                const Icon = s.icon
                return (
                  <li key={s.label} className="relative pl-10 pb-5 last:pb-0">
                    <div className="absolute left-0 top-0 h-6 w-6 rounded-[4px] border border-primary/50 bg-background flex items-center justify-center text-primary">
                      <Icon className="h-3 w-3" />
                    </div>
                    <div className="micro">{i + 1}. {s.label}</div>
                    <div className="mt-1 text-[13px] leading-relaxed whitespace-pre-line">{s.value ?? '—'}</div>
                  </li>
                )
              })}
            </ol>
          </Panel>

          <Panel title={`Evidence records (${f.evidence.length})`} sub="Every claim links to a verifiable source">
            <div className="scanline divide-y divide-border -mx-1 px-1 stagger-fast">
              {f.evidence.map((e, i) => {
                const dot =
                  e.source === 'contract' ? 'bg-emerald-600'
                  : e.source === 'invoice' ? 'bg-amber-500'
                  : e.source === 'jira' || e.source === 'github' ? 'bg-rose-500'
                  : 'bg-stone-400'
                return (
                  <div key={e.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={cn('h-2 w-2 rounded-[2px] shrink-0', dot)} aria-hidden />
                      <span className="num text-[10px] font-semibold text-muted-foreground">E-{String(i + 1).padStart(2, '0')}</span>
                      <Badge variant="outline" className="text-[10px]">{sourceLabel(e.source)}</Badge>
                      <span className="micro normal-case tracking-normal">{evidenceTypeLabel(e.evidenceType)}</span>
                      {e.refId && <code className="num text-[10px] text-muted-foreground/80">{e.refId}</code>}
                      <span className="ml-auto flex items-center gap-3 text-[10px] text-muted-foreground">
                        {e.weight != null && <span className="num">weight {(e.weight * 100).toFixed(0)}%</span>}
                        {e.timestamp && <span className="num">{formatDateTime(e.timestamp)}</span>}
                      </span>
                    </div>
                    <div className="text-[13px] font-medium">{e.title}</div>
                    {e.detail && <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{e.detail}</p>}
                  </div>
                )
              })}
            </div>
          </Panel>
        </div>

        {/* RIGHT: Verdict + actions */}
        <div className="space-y-4 stagger">
          <Panel title="Confidence decomposition" sub="Explicit rubrics, never one opaque number">
            <div className="space-y-2.5">
              {subScores.map((s, i) => (
                <div key={s.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">{s.label}</span>
                    <span className="num font-medium">{(s.value * 100).toFixed(0)}%</span>
                  </div>
                  {/* ink-fill: each pillar rules itself in, staggered */}
                  <div className="h-1.5 bg-muted overflow-hidden rounded-[1px]">
                    <div
                      className="ink-fill h-full bg-primary"
                      style={{ width: `${s.value * 100}%`, ['--ink-delay' as string]: `${0.15 + i * 0.12}s` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-[13px]">
              <span className="text-muted-foreground">Composite</span>
              <span className="num font-semibold">{f.confidence != null ? f.confidence.toUpperCase() : '—'} · {f.confidenceScore != null ? (f.confidenceScore * 100).toFixed(0) + '%' : '—'}</span>
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground leading-relaxed">
              {usingStoredBreakdown
                ? 'Per-pillar sub-scores computed by the reconciliation engine from the evidence rubric (§9.4). Hand-tuned weights; only moves to a learned model once enough human-labeled outcomes exist.'
                : 'No engine-computed breakdown stored for this finding (legacy or manually created) — showing sub-scores synthesized from the evidence weights.'}
            </p>
          </Panel>

          <div className="no-print">
            <Panel title="Review" sub="The product proposes, it never asserts">
              <div className="micro mb-1.5">Reviewer notes</div>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes for the case file (visible to other reviewers, captured in audit log)…"
                rows={4}
                className="text-xs"
              />
              <div className="mt-3 grid grid-cols-3 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => takeAction('dismiss')}
                  disabled={!isPending || actionLoading}
                  className="w-full"
                >
                  <XCircle className="h-3.5 w-3.5 mr-1" />
                  Dismiss
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => takeAction('escalate')}
                  disabled={!isPending || actionLoading}
                  className="w-full border-amber-300 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/30"
                >
                  <AlertCircle className="h-3.5 w-3.5 mr-1" />
                  Escalate
                </Button>
                <Button
                  size="sm"
                  onClick={() => takeAction('approve')}
                  disabled={!isPending || actionLoading}
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                  Approve
                </Button>
              </div>
              {f.reviewedAt && (
                <div className="num mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
                  last reviewed {formatDate(f.reviewedAt)}
                </div>
              )}
            </Panel>
          </div>

          <div className="no-print">
            <Panel title="Export case file" sub="What you bring to the client conversation">
              <p className="text-xs text-muted-foreground mb-3">
                Every claim, the contract clause, the delivery evidence, the billing gap — exported
                from the live finding record. Two real formats today:
              </p>
              <div className="space-y-2">
                <Button variant="outline" size="sm" className="w-full justify-start" onClick={downloadCaseFile}>
                  <FileCheck2 className="h-3.5 w-3.5 mr-1.5" />
                  Download case file (JSON)
                </Button>
                <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => window.print()}>
                  <FileText className="h-3.5 w-3.5 mr-1.5" />
                  Print / save as PDF
                </Button>
              </div>
              <p className="mt-3 text-[10px] text-muted-foreground">
                Print renders just this case file (app chrome is stripped). A branded PDF
                template is on the roadmap (§9.6). The JSON export is complete and
                machine-readable today.
              </p>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  )
}

/* Panel — the workbench section: hairline box + micro header rule */
function Panel({ title, sub, children, className }: {
  title: string
  sub?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn('border border-border rounded-md bg-card', className)}>
      <div className="border-b border-border px-4 py-2.5">
        <h2 className="micro">{title}</h2>
        {sub && <p className="text-[10px] text-muted-foreground/70 mt-0.5 normal-case tracking-normal">{sub}</p>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}
