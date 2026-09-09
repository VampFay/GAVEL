'use client'

import { useEffect, useState, useRef } from 'react'
import { useAppStore } from '@/stores/app-store'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ArrowLeft,
  FileText,
  GitBranch,
  ClipboardCheck,
  Activity,
  IndianRupee,
  Calendar,
  Building2,
  Layers,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  CircleDot,
  AlertCircle,
  RotateCw,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  formatINR, formatINRCompact, formatDate, findingTypeLabel,
  statusColor, assessmentLabel, recommendedActionLabel,
} from '@/lib/gavel'
import { apiGet } from '@/lib/fetch'
import { cn } from '@/lib/utils'
import { CountUp } from './count-up'

interface AuditDetail {
  ok: boolean
  client: {
    id: string
    name: string
    industry: string | null
    sizeBand: string | null
    // contactName + contactEmail intentionally omitted (PII; route
    // no longer returns them pending auth wiring).
  }
  contract: {
    id: string
    title: string
    rawText: string | null
    extractedJson: string | null
    effectiveDate: string
    endDate: string | null
    totalValue: number | null
    currency: string
    lineItems: Array<{ id: string; description: string; rate: number | null; rateUnit: string | null; quantity: number | null; milestone: string | null; deliveryDate: string | null }>
    changeOrders: Array<{ id: string; title: string; description: string; value: number | null; signedDate: string }>
    invoices: Array<{ id: string; number: string; issueDate: string; status: string; total: number; currency: string; lines: Array<{ id: string; description: string; amount: number }> }>
    findings: Array<FindingLite>
  }
  project: {
    id: string
    name: string
    status: string
    startDate: string | null
    endDate: string | null
    tickets: Array<{ id: string; externalId: string; title: string; type: string | null; status: string; assignee: string | null; externalUpdated: string | null }>
    codeActivities: Array<{ id: string; type: string; ref: string; title: string; author: string; timestamp: string; additions: number | null; deletions: number | null; filesChanged: number | null; url: string | null }>
    monitored: { id: string; alertsEnabled: boolean; driftBaseline: number | null } | null
  }
}

interface FindingLite {
  id: string
  type: string
  title: string
  impactAmount: number | null
  confidence: string
  confidenceScore: number | null
  assessment: string
  recommendedAction: string
  status: string
  contractClause: string | null
}

export function AuditDetailView() {
  const { activeAuditId, setView, openFinding } = useAppStore()
  const [data, setData] = useState<AuditDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = async () => {
    if (!activeAuditId) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    const { data: d, error: e } = await apiGet<AuditDetail>(`/api/audits/${activeAuditId}`, ctrl.signal)
    if (e) {
      setError(e.message)
      toast.error('Failed to load audit', { description: e.message })
    } else if (d) {
      setData(d)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    return () => abortRef.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAuditId])

  if (loading || !data) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-3" aria-busy="true">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-72 w-full" />
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
            <p className="text-sm font-medium">Couldn&apos;t load audit</p>
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

  const contract = data.contract
  const project = data.project
  const findings = contract.findings
  const totalImpact = findings.filter(f => f.status !== 'dismissed').reduce((s, f) => s + (f.impactAmount ?? 0), 0)
  const approvedImpact = findings.filter(f => f.status === 'approved').reduce((s, f) => s + (f.impactAmount ?? 0), 0)

  let extracted: { milestones?: Array<{ id: string; description: string; dueDate: string; value: number | null }>; exclusions?: Array<{ clause: string; description: string }> } = {}
  try { extracted = JSON.parse(contract.extractedJson ?? '{}') } catch {}

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <Button variant="ghost" size="sm" onClick={() => setView('audits')} className="mb-4 -ml-2 text-muted-foreground">
        <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
        All audits
      </Button>

      {/* Case masthead */}
      <div className="border border-border rounded-md bg-card overflow-hidden mb-4">
        <div className="px-4 md:px-5 pt-4 pb-3 border-b border-border flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap micro">
              <Building2 className="h-3 w-3" />
              <span className="normal-case tracking-normal text-[11px] font-semibold text-foreground/80">{data.client.name}</span>
              {data.client.sizeBand && <Badge variant="outline" className="text-[9px] px-1 py-0">{data.client.sizeBand}</Badge>}
              {project.monitored && (
                <Badge className="text-[9px] px-1.5 py-0 h-auto bg-primary/10 text-primary border border-primary/20">
                  <Activity className="h-2.5 w-2.5 mr-0.5" /> Monitored
                </Badge>
              )}
            </div>
            <h1 className="text-lg font-semibold tracking-tight mt-1.5 leading-snug">{contract.title}</h1>
            <p className="num text-[11px] text-muted-foreground mt-1">
              {project.name} · {project.status} · {formatDate(contract.effectiveDate)} → {formatDate(contract.endDate)}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-border">
          <div className="px-4 py-3">
            <div className="micro">Unbilled identified</div>
            <div className="num text-xl font-semibold text-primary leading-none mt-1">
              <CountUp value={totalImpact} format={formatINRCompact} />
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="micro">Approved</div>
            <div className="num text-xl font-semibold leading-none mt-1">
              <CountUp value={approvedImpact} format={formatINRCompact} />
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="micro">Contract value</div>
            <div className="num text-xl font-semibold leading-none mt-1">
              <CountUp value={contract.totalValue} format={formatINRCompact} />
            </div>
          </div>
        </div>
      </div>

      {/* Reconciliation pipeline */}
      <div className="border border-border rounded-md bg-card mb-4">
        <div className="border-b border-border px-4 py-2.5">
          <h2 className="micro">Reconciliation pipeline — raw records to evidence-backed findings</h2>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-7 gap-1.5 md:gap-1 items-center">
            <FlowNode icon={FileText} title="SOW" sub={`${contract.lineItems.length} line items`} tone="emerald" />
            <FlowArrow />
            <FlowNode icon={Layers} title="Normalize" sub="LLM + validation" tone="emerald" />
            <FlowArrow />
            <FlowNode icon={GitBranch} title="Resolve" sub={`${project.tickets.length} tk · ${project.codeActivities.length} PR`} tone="emerald" />
            <FlowArrow />
            <FlowNode icon={AlertTriangle} title="Rules" sub="3 deterministic" tone="amber" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-7 gap-1.5 md:gap-1 items-center mt-1.5">
            <FlowNode icon={CircleDot} title="Confidence" sub="decomposed" tone="amber" />
            <FlowArrow />
            <FlowNode icon={ClipboardCheck} title="Review" sub={`${findings.filter(f => f.status === 'pending_review').length} pending`} tone="amber" />
            <FlowArrow />
            <FlowNode icon={IndianRupee} title="Case file" sub={`${findings.length} findings`} tone="emerald" />
            <FlowArrow />
            <FlowNode icon={CheckCircle2} title="Bill / dismiss" sub={formatINRCompact(approvedImpact)} tone="emerald" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Findings */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Findings ({findings.length})</h2>
            <Button variant="outline" size="sm" onClick={() => setView('review_queue')}>
              Open review queue <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </div>
          {findings.length === 0 && (
            <div className="border border-dashed rounded-md p-6 text-center text-sm text-muted-foreground">No findings yet — run the forensic engine.</div>
          )}
          <div className="divide-y divide-border border-t border-border stagger-fast">
          {findings.map(f => {
            const stat = statusColor(f.status)
            const spine = f.status === 'pending_review' ? 'border-l-amber-500' : f.status === 'approved' ? 'border-l-emerald-600' : f.status === 'dismissed' ? 'border-l-stone-400' : 'border-l-rose-500'
            return (
              <button key={f.id} className={cn('ledger-row w-full text-left border-l-[3px] py-3 pl-3.5 hover:bg-muted/40 transition-colors', spine)} onClick={() => openFinding(f.id)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px] font-semibold">{findingTypeLabel(f.type)}</Badge>
                      <Badge variant="outline" className={cn('text-[10px]', stat.bg, stat.text, stat.border)}>{f.status.replace('_', ' ')}</Badge>
                      <span className="num text-[10px] text-muted-foreground">{f.confidence} · {f.confidenceScore != null ? (f.confidenceScore * 100).toFixed(0) + '%' : '—'}</span>
                    </div>
                    <h3 className="text-[13px] font-semibold mt-1.5 leading-snug">{f.title}</h3>
                    {f.contractClause && (
                      <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{f.contractClause}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="num text-lg font-semibold text-foreground leading-none">{formatINRCompact(f.impactAmount)}</div>
                    <div className="micro mt-1">{assessmentLabel(f.assessment)}</div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Recommended: <span className="text-foreground">{recommendedActionLabel(f.recommendedAction)}</span></span>
                  <span className="inline-flex items-center gap-1 text-primary">Open case file <ArrowRight className="h-3 w-3" /></span>
                </div>
              </button>
            )
          })}
          </div>
        </div>

        {/* Right column: contract + delivery summary */}
        <div className="space-y-4 stagger">
          <Panel title="Contract extraction" icon={<FileText className="h-3.5 w-3.5 text-primary" />} sub="LLM-extracted scope & milestones">
            <div>
              <div className="micro mb-1.5">Milestones</div>
              <div className="divide-y divide-border">
                {(extracted.milestones ?? []).map(m => (
                  <div key={m.id} className="flex items-center justify-between text-xs py-1.5">
                    <div className="min-w-0">
                      <code className="num text-[10px] font-semibold">{m.id}</code>
                      <span className="ml-2">{m.description}</span>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <div className="num">{formatINR(m.value)}</div>
                      <div className="num text-[10px] text-muted-foreground">{formatDate(m.dueDate)}</div>
                    </div>
                  </div>
                ))}
                {(!extracted.milestones || extracted.milestones.length === 0) && (
                  <p className="text-xs text-muted-foreground">No milestones parsed.</p>
                )}
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-border">
              <div className="micro mb-1.5">Exclusions</div>
              <div className="space-y-1.5">
                {(extracted.exclusions ?? []).map(e => (
                  <div key={e.clause} className="text-xs">
                    <code className="num text-[10px] px-1 py-0.5 rounded-sm bg-muted">§{e.clause}</code>
                    <span className="ml-1.5 text-muted-foreground">{e.description}</span>
                  </div>
                ))}
                {(!extracted.exclusions || extracted.exclusions.length === 0) && (
                  <p className="text-xs text-muted-foreground">No exclusions parsed.</p>
                )}
              </div>
            </div>
          </Panel>

          <Panel title="Delivery evidence" icon={<GitBranch className="h-3.5 w-3.5 text-primary" />} sub="Tickets & code activity">
            <div className="space-y-1 max-h-72 overflow-y-auto scrollbar-thin">
              {project.codeActivities.map(c => (
                <div key={c.id} className="flex items-start gap-2 py-1.5 border-b border-border last:border-0 text-xs">
                  <Badge variant="outline" className="text-[9px] shrink-0">{c.type.toUpperCase()}</Badge>
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{c.title}</div>
                    <div className="num text-[10px] text-muted-foreground mt-0.5">
                      {c.ref} · {c.author} · {formatDate(c.timestamp)}
                      {c.additions != null && ` · +${c.additions}/-${c.deletions ?? 0}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Invoices" icon={<IndianRupee className="h-3.5 w-3.5 text-primary" />}>
            <div className="space-y-2.5 divide-y divide-border">
              {contract.invoices.map(inv => (
                <div key={inv.id} className="text-xs">
                  <div className="flex items-center justify-between pt-2 first:pt-0">
                    <span className="num font-semibold">{inv.number}</span>
                    <Badge variant="outline" className="text-[10px]">{inv.status}</Badge>
                  </div>
                  <div className="num text-[10px] text-muted-foreground mt-0.5">
                    {formatINR(inv.total)} · issued {formatDate(inv.issueDate)}
                  </div>
                  <ul className="mt-1 ml-2 text-[10px] text-muted-foreground space-y-0.5">
                    {inv.lines.map(l => (
                      <li key={l.id}>· {l.description} — <span className="num">{formatINR(l.amount)}</span></li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}

function FlowNode({
  icon: Icon, title, sub, tone,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  sub: string
  tone: 'emerald' | 'amber'
}) {
  return (
    <div className={cn(
      'rounded-md border p-2 text-center',
      tone === 'emerald'
        ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30'
        : 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30'
    )}>
      <div className={cn(
        'mx-auto h-6 w-6 rounded-[4px] flex items-center justify-center mb-1',
        tone === 'emerald' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
      )}>
        <Icon className="h-3 w-3" />
      </div>
      <div className="text-[11px] font-semibold leading-none">{title}</div>
      <div className="num text-[9px] text-muted-foreground mt-1 leading-none">{sub}</div>
    </div>
  )
}

function FlowArrow() {
  return (
    <div className="hidden md:flex items-center justify-center text-muted-foreground/60">
      <ArrowRight className="h-3 w-3" />
    </div>
  )
}

/* Panel — the workbench section: hairline box + micro header rule */
function Panel({ title, sub, icon, children, className }: {
  title: string
  sub?: string
  icon?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn('border border-border rounded-md bg-card', className)}>
      <div className="border-b border-border px-4 py-2.5">
        <h2 className="micro flex items-center gap-1.5">{icon}{title}</h2>
        {sub && <p className="text-[10px] text-muted-foreground/70 mt-0.5 normal-case tracking-normal">{sub}</p>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}
