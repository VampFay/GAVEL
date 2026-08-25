'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAppStore } from '@/stores/app-store'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import {
  ArrowLeft, FileText, GitBranch, ClipboardCheck, AlertTriangle,
  CheckCircle2, XCircle, AlertCircle, IndianRupee, ArrowRight,
  Scale, Calendar, FileCheck2, ExternalLink,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  formatINR, formatINRCompact, formatDateTime, formatDate, findingTypeLabel,
  confidenceColor, statusColor, assessmentLabel, recommendedActionLabel,
  evidenceTypeLabel, sourceLabel, sourceColor,
} from '@/lib/shipledger'

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
    assessment: string
    recommendedAction: string
    status: string
    contractClause: string | null
    billingState: string | null
    reviewNotes: string | null
    reviewedAt: string | null
    reviewedBy: string | null
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
  const { activeFindingId, setView } = useAppStore()
  const [data, setData] = useState<FindingDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [notes, setNotes] = useState('')

  const load = useCallback(() => {
    if (!activeFindingId) return
    setLoading(true)
    fetch(`/api/findings/${activeFindingId}`)
      .then(r => r.json())
      .then(d => {
        setData(d)
        setNotes(d.finding?.reviewNotes ?? '')
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [activeFindingId])

  useEffect(() => { load() }, [load])

  const takeAction = async (action: 'approve' | 'dismiss' | 'escalate') => {
    if (!activeFindingId) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/findings/${activeFindingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reviewNotes: notes, actor: 'reviewer@shipledger' }),
      })
      const d = await res.json()
      if (d.ok) {
        toast.success(`Finding ${action}d`)
        load()
      } else {
        toast.error('Action failed', { description: d.error })
      }
    } finally {
      setActionLoading(false)
    }
  }

  if (loading || !data) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  const f = data.finding
  const conf = confidenceColor(f.confidence)
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

  // Confidence decomposition (synthetic from sub-scores — mirrors §9.4 of the plan)
  const contractClarity = f.evidence.find(e => e.evidenceType === 'contract_clause')?.weight ?? 0.3
  const deliveryStrength = f.evidence.filter(e => e.evidenceType === 'delivery_record').reduce((s, e) => s + (e.weight ?? 0), 0)
  const authorizationPresence = f.evidence.find(e => e.source === 'change_order')?.weight ?? 0.1
  const billingGapCertainty = f.evidence.find(e => e.evidenceType === 'billing_record')?.weight ?? 0.1
  const subScores = [
    { label: 'Contract clarity', value: Math.min(contractClarity, 1) },
    { label: 'Delivery-evidence strength', value: Math.min(deliveryStrength, 1) },
    { label: 'Authorization presence', value: Math.min(authorizationPresence, 1) },
    { label: 'Billing-gap certainty', value: Math.min(billingGapCertainty, 1) },
  ]

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <Button variant="ghost" size="sm" onClick={() => setView('review_queue')} className="mb-4 -ml-2 text-muted-foreground">
        <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
        Back to review queue
      </Button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className={`text-[10px] ${conf.bg} ${conf.text} ${conf.border}`}>{findingTypeLabel(f.type)}</Badge>
            <Badge variant="outline" className={`text-[10px] ${stat.bg} ${stat.text} ${stat.border}`}>{f.status.replace('_', ' ')}</Badge>
            <Badge variant="outline" className={`text-[10px] ${conf.bg} ${conf.text} ${conf.border}`}>{f.confidence} · {f.confidenceScore != null ? (f.confidenceScore * 100).toFixed(0) + '%' : '—'}</Badge>
            <Badge variant="outline" className="text-[10px]"><Scale className="h-2.5 w-2.5 mr-0.5" />{assessmentLabel(f.assessment)}</Badge>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mt-2">{f.title}</h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed max-w-3xl">{f.summary}</p>
          <div className="mt-2 text-xs text-muted-foreground flex flex-wrap gap-3">
            {f.project && (
              <span className="flex items-center gap-1">
                <FileCheck2 className="h-3 w-3" />
                {f.project.client?.name ?? '—'} · {f.project.name}
              </span>
            )}
            {f.contract && (
              <span className="flex items-center gap-1">
                <FileText className="h-3 w-3" />
                {f.contract.title}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Detected {formatDate(f.createdAt)}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-3xl font-semibold text-primary leading-none">{formatINRCompact(f.impactAmount)}</div>
          <div className="text-xs text-muted-foreground mt-1">impact identified</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">contract: {formatINRCompact(f.contract?.totalValue)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* LEFT: Anatomy timeline */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Finding anatomy</CardTitle>
              <CardDescription>Commercial baseline → delivery evidence → billing state → assessment → recommended action</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="relative">
                {/* vertical line */}
                <div className="absolute left-3 top-2 bottom-2 w-px bg-border" aria-hidden />
                {stages.map((s, i) => {
                  const Icon = s.icon
                  return (
                    <li key={s.label} className="relative pl-10 pb-5 last:pb-0">
                      <div className="absolute left-0 top-0 h-6 w-6 rounded-full border-2 border-primary bg-background flex items-center justify-center text-primary">
                        <Icon className="h-3 w-3" />
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{i + 1}. {s.label}</div>
                      <div className="mt-1 text-sm leading-relaxed whitespace-pre-line">{s.value ?? '—'}</div>
                    </li>
                  )
                })}
              </ol>
            </CardContent>
          </Card>

          {/* Evidence detail */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Evidence records ({f.evidence.length})</CardTitle>
              <CardDescription>Every claim links back to a verifiable source</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {f.evidence.map(e => {
                  const sc = sourceColor(e.source)
                  return (
                    <div key={e.id} className="p-3 rounded-lg border border-border bg-muted/30">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <Badge variant="outline" className={`text-[10px] ${sc.bg} ${sc.text}`}>{sourceLabel(e.source)}</Badge>
                        <Badge variant="outline" className="text-[10px]">{evidenceTypeLabel(e.evidenceType)}</Badge>
                        {e.refId && <code className="text-[10px] text-muted-foreground">{e.refId}</code>}
                        {e.weight != null && (
                          <span className="text-[10px] text-muted-foreground ml-auto">weight: {(e.weight * 100).toFixed(0)}%</span>
                        )}
                        {e.timestamp && (
                          <span className="text-[10px] text-muted-foreground ml-auto">{formatDateTime(e.timestamp)}</span>
                        )}
                      </div>
                      <div className="text-sm font-medium">{e.title}</div>
                      {e.detail && <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{e.detail}</p>}
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: Confidence + actions */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Confidence decomposition</CardTitle>
              <CardDescription>Sub-scores from explicit rubrics, never a single opaque number</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {subScores.map(s => (
                  <div key={s.label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">{s.label}</span>
                      <span className="font-medium">{(s.value * 100).toFixed(0)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${s.value * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <Separator className="my-4" />
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Composite</span>
                <span className="font-semibold">{f.confidenceScore != null ? (f.confidenceScore * 100).toFixed(0) + '%' : '—'}</span>
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground leading-relaxed">
                Hand-tuned weighted average initially. Only moves to a learned model once enough human-labeled outcomes (approved/dismissed findings) exist to validate one.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Review</CardTitle>
              <CardDescription>The product proposes, it never asserts.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-muted-foreground mb-2">Reviewer notes</div>
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
                <div className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
                  Last reviewed {formatDate(f.reviewedAt)} by {f.reviewedBy ?? '—'}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Export case file</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                The case file is what you bring to the client conversation — every claim, the contract clause, the delivery evidence, the billing gap. Currently scoped to the Free diagnostic only when not on a paid audit tier.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => toast.info('Case-file PDF export', { description: 'In production this calls the report-render service — see /download for the artifact.' })}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                Generate PDF
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
