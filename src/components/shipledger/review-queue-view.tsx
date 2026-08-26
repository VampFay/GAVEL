'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAppStore } from '@/stores/app-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  ClipboardCheck,
  CheckCircle2,
  XCircle,
  AlertCircle,
  FileText,
  ArrowRight,
  Filter,
  IndianRupee,
  Scale,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  formatINR, formatINRCompact, findingTypeLabel,
  confidenceColor, statusColor, assessmentLabel, recommendedActionLabel,
  evidenceTypeLabel, sourceLabel, sourceColor, formatDate, timeAgo,
} from '@/lib/shipledger'

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
  reviewedBy: string | null
  createdAt: string
  project: { id: string; name: string } | null
  contract: { id: string; title: string } | null
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

type Tab = 'pending_review' | 'approved' | 'dismissed' | 'escalated' | 'all'

export function ReviewQueueView() {
  const { openFinding } = useAppStore()
  const [findings, setFindings] = useState<Finding[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('pending_review')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/findings')
      .then(r => r.json())
      .then(d => {
        setFindings(d.findings)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const takeAction = async (id: string, action: 'approve' | 'dismiss' | 'escalate') => {
    setActionLoading(id)
    try {
      const res = await fetch(`/api/findings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, actor: 'reviewer@shipledger' }),
      })
      const d = await res.json()
      if (d.ok) {
        toast.success(`Finding ${action}d`, {
          description: action === 'approve'
            ? 'Moved to approved — eligible for billing.'
            : action === 'dismiss'
              ? 'Marked as dismissed — excluded from case file.'
              : 'Escalated to senior review.',
        })
        load()
      } else {
        toast.error('Action failed', { description: d.error })
      }
    } catch (e) {
      toast.error('Action failed', { description: e instanceof Error ? e.message : 'unknown' })
    } finally {
      setActionLoading(null)
    }
  }

  if (loading || !findings) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-3">
        <Skeleton className="h-12 w-full" />
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
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
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {counts.pendingReview} pending review · {formatINRCompact(totalImpact)} total identified · the product proposes, humans assert
          </p>
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
        <Card className="border-dashed">
          <CardContent className="p-10 text-center">
            <div className="h-10 w-10 rounded-full bg-muted text-muted-foreground flex items-center justify-center mx-auto mb-3">
              <Filter className="h-4 w-4" />
            </div>
            <p className="text-sm text-muted-foreground">No findings in this state.</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {filtered.map(f => (
          <FindingCard
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

function FindingCard({
  finding, onAction, actionLoading, onOpen,
}: {
  finding: Finding
  onAction: (id: string, action: 'approve' | 'dismiss' | 'escalate') => void
  actionLoading: boolean
  onOpen: () => void
}) {
  const conf = confidenceColor(finding.confidence)
  const stat = statusColor(finding.status)
  const isPending = finding.status === 'pending_review'

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="outline" className={`text-[10px] ${conf.bg} ${conf.text} ${conf.border}`}>
                {findingTypeLabel(finding.type)}
              </Badge>
              <Badge variant="outline" className={`text-[10px] ${stat.bg} ${stat.text} ${stat.border}`}>
                {finding.status.replace('_', ' ')}
              </Badge>
              <Badge variant="outline" className={`text-[10px] ${conf.bg} ${conf.text} ${conf.border}`}>
                {finding.confidence} · {finding.confidenceScore != null ? (finding.confidenceScore * 100).toFixed(0) + '%' : '—'}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                <Scale className="h-2.5 w-2.5 mr-0.5" />{assessmentLabel(finding.assessment)}
              </Badge>
              {finding.project && (
                <span className="text-[10px] text-muted-foreground">
                  {finding.project.name}
                </span>
              )}
            </div>
            <h3 className="font-medium text-sm mt-2.5 leading-snug">{finding.title}</h3>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{finding.summary}</p>

            {/* Finding anatomy — the case-file skeleton */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
              <AnatomyRow label="Commercial baseline" value={finding.contractClause} />
              <AnatomyRow label="Billing state" value={finding.billingState} />
              <AnatomyRow label="Recommended" value={recommendedActionLabel(finding.recommendedAction)} />
              {finding.reviewedAt && (
                <AnatomyRow label="Reviewed" value={`${formatDate(finding.reviewedAt)} by ${finding.reviewedBy ?? '—'}`} />
              )}
            </div>
          </div>

          <div className="text-right shrink-0">
            <div className="text-2xl font-semibold text-primary leading-none">{formatINRCompact(finding.impactAmount)}</div>
            <div className="text-[10px] text-muted-foreground mt-1">impact</div>
          </div>
        </div>

        {/* Evidence preview */}
        {finding.evidence.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Evidence ({finding.evidence.length})</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
              {finding.evidence.slice(0, 4).map(e => {
                const sc = sourceColor(e.source)
                return (
                  <div key={e.id} className="flex items-start gap-2 p-2 rounded border border-border bg-muted/30">
                    <Badge variant="outline" className={`text-[9px] shrink-0 ${sc.bg} ${sc.text}`}>{sourceLabel(e.source)}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-medium truncate">{e.title}</div>
                      {e.detail && <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{e.detail}</div>}
                      <div className="text-[9px] text-muted-foreground mt-0.5">
                        {evidenceTypeLabel(e.evidenceType)}
                        {e.timestamp && ` · ${formatDate(e.timestamp)}`}
                        {e.weight != null && ` · weight ${(e.weight * 100).toFixed(0)}%`}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="mt-4 pt-4 border-t border-border flex items-center justify-between flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={onOpen} className="text-primary">
            <FileText className="h-3.5 w-3.5 mr-1" />
            Open full case file
            <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
          {isPending && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onAction(finding.id, 'dismiss')}
                disabled={actionLoading}
              >
                <XCircle className="h-3.5 w-3.5 mr-1" />
                Dismiss
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onAction(finding.id, 'escalate')}
                disabled={actionLoading}
                className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/30"
              >
                <AlertCircle className="h-3.5 w-3.5 mr-1" />
                Escalate
              </Button>
              <Button
                size="sm"
                onClick={() => onAction(finding.id, 'approve')}
                disabled={actionLoading}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                Approve &amp; bill
              </Button>
            </div>
          )}
          {!isPending && finding.reviewNotes && (
            <div className="text-xs text-muted-foreground italic max-w-md">
              &ldquo;{finding.reviewNotes}&rdquo; — {finding.reviewedBy}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function AnatomyRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="p-2 rounded border border-border bg-muted/30">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-[11px] leading-snug">{value ?? '—'}</div>
    </div>
  )
}
