'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
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
} from 'lucide-react'
import {
  formatINR, formatINRCompact, formatDate, findingTypeLabel,
  confidenceColor, statusColor, assessmentLabel, recommendedActionLabel,
} from '@/lib/shipledger'

interface AuditDetail {
  ok: boolean
  client: {
    id: string
    name: string
    industry: string | null
    sizeBand: string | null
    contactName: string | null
    contactEmail: string | null
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
    tickets: Array<{ id: string; externalId: string; title: string; type: string | null; status: string; assignee: string | null; updated: string }>
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

  useEffect(() => {
    if (!activeAuditId) return
    setLoading(true)
    fetch(`/api/audits/${activeAuditId}`)
      .then(r => r.json())
      .then(d => {
        setData(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [activeAuditId])

  if (loading || !data) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-72 w-full" />
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

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Building2 className="h-3 w-3" />
            {data.client.name}
            {data.client.sizeBand && <Badge variant="outline" className="text-[10px]">{data.client.sizeBand}</Badge>}
            {project.monitored && (
              <Badge className="text-[10px] bg-primary/10 text-primary border border-primary/20">
                <Activity className="h-2.5 w-2.5 mr-0.5" /> Monitored
              </Badge>
            )}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">{contract.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {project.name} · {project.status} · {formatDate(contract.effectiveDate)} → {formatDate(contract.endDate)}
          </p>
        </div>
        <div className="flex gap-4">
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Unbilled identified</div>
            <div className="text-xl font-semibold text-primary">{formatINRCompact(totalImpact)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Approved</div>
            <div className="text-xl font-semibold">{formatINRCompact(approvedImpact)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Contract value</div>
            <div className="text-xl font-semibold">{formatINRCompact(contract.totalValue)}</div>
          </div>
        </div>
      </div>

      {/* Reconciliation flow diagram */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Reconciliation flow</CardTitle>
          <CardDescription>From raw records to evidence-backed finding</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-7 gap-2 md:gap-1 items-center">
            <FlowNode icon={FileText} title="SOW" sub={`${contract.lineItems.length} line items`} tone="emerald" />
            <FlowArrow />
            <FlowNode icon={Layers} title="Normalize" sub="LLM + deterministic" tone="emerald" />
            <FlowArrow />
            <FlowNode icon={GitBranch} title="Entity resolution" sub={`${project.tickets.length} tickets · ${project.codeActivities.length} PRs`} tone="emerald" />
            <FlowArrow />
            <FlowNode icon={AlertTriangle} title="Forensic engine" sub="rules + LLM" tone="amber" />
          </div>
          <div className="hidden md:block mt-1" />
          <div className="grid grid-cols-1 md:grid-cols-7 gap-2 md:gap-1 items-center mt-2">
            <FlowNode icon={CircleDot} title="Confidence" sub="decomposed" tone="amber" />
            <FlowArrow />
            <FlowNode icon={ClipboardCheck} title="Human review" sub={`${findings.filter(f => f.status === 'pending_review').length} pending`} tone="amber" />
            <FlowArrow />
            <FlowNode icon={IndianRupee} title="Case file" sub={`${findings.length} findings`} tone="emerald" />
            <FlowArrow />
            <FlowNode icon={CheckCircle2} title="Bill / dismiss" sub={`${formatINRCompact(approvedImpact)} approved`} tone="emerald" />
          </div>
        </CardContent>
      </Card>

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
            <Card className="border-dashed"><CardContent className="p-6 text-center text-sm text-muted-foreground">No findings yet — run the forensic engine.</CardContent></Card>
          )}
          {findings.map(f => {
            const conf = confidenceColor(f.confidence)
            const stat = statusColor(f.status)
            return (
              <Card key={f.id} className="hover:border-primary/40 transition-colors">
                <button className="w-full text-left" onClick={() => openFinding(f.id)}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className={`text-[10px] ${conf.bg} ${conf.text} ${conf.border}`}>{findingTypeLabel(f.type)}</Badge>
                          <Badge variant="outline" className={`text-[10px] ${stat.bg} ${stat.text} ${stat.border}`}>{f.status.replace('_', ' ')}</Badge>
                          <Badge variant="outline" className={`text-[10px] ${conf.bg} ${conf.text} ${conf.border}`}>{f.confidence} · {f.confidenceScore != null ? (f.confidenceScore * 100).toFixed(0) + '%' : '—'}</Badge>
                        </div>
                        <h3 className="font-medium text-sm mt-2 leading-snug">{f.title}</h3>
                        {f.contractClause && (
                          <p className="text-[11px] text-muted-foreground mt-1.5 line-clamp-2">{f.contractClause}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-lg font-semibold text-primary">{formatINRCompact(f.impactAmount)}</div>
                        <div className="text-[10px] text-muted-foreground">{assessmentLabel(f.assessment)}</div>
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Recommended: <span className="text-foreground">{recommendedActionLabel(f.recommendedAction)}</span></span>
                      <span className="inline-flex items-center gap-1 text-primary">Open case file <ArrowRight className="h-3 w-3" /></span>
                    </div>
                  </CardContent>
                </button>
              </Card>
            )
          })}
        </div>

        {/* Right column: contract + delivery summary */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-1.5">
                <FileText className="h-4 w-4 text-primary" /> Contract extraction
              </CardTitle>
              <CardDescription>LLM-extracted scope & milestones</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="text-xs text-muted-foreground mb-1.5">Milestones</div>
                <div className="space-y-1">
                  {(extracted.milestones ?? []).map(m => (
                    <div key={m.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border last:border-0">
                      <div>
                        <code className="text-[10px] font-medium">{m.id}</code>
                        <span className="ml-2">{m.description}</span>
                      </div>
                      <div className="text-right">
                        <div>{formatINR(m.value)}</div>
                        <div className="text-[10px] text-muted-foreground">{formatDate(m.dueDate)}</div>
                      </div>
                    </div>
                  ))}
                  {(!extracted.milestones || extracted.milestones.length === 0) && (
                    <p className="text-xs text-muted-foreground">No milestones parsed.</p>
                  )}
                </div>
              </div>
              <Separator />
              <div>
                <div className="text-xs text-muted-foreground mb-1.5">Exclusions</div>
                <div className="space-y-1.5">
                  {(extracted.exclusions ?? []).map(e => (
                    <div key={e.clause} className="text-xs">
                      <code className="text-[10px] px-1 py-0.5 rounded bg-muted">§{e.clause}</code>
                      <span className="ml-1.5 text-muted-foreground">{e.description}</span>
                    </div>
                  ))}
                  {(!extracted.exclusions || extracted.exclusions.length === 0) && (
                    <p className="text-xs text-muted-foreground">No exclusions parsed.</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-1.5">
                <GitBranch className="h-4 w-4 text-primary" /> Delivery evidence
              </CardTitle>
              <CardDescription>Tickets & code activity</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5 max-h-72 overflow-y-auto scrollbar-thin">
                {project.codeActivities.map(c => (
                  <div key={c.id} className="flex items-start gap-2 py-1.5 border-b border-border last:border-0 text-xs">
                    <Badge variant="outline" className="text-[9px] shrink-0">{c.type.toUpperCase()}</Badge>
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{c.title}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {c.ref} · {c.author} · {formatDate(c.timestamp)}
                        {c.additions != null && ` · +${c.additions}/-${c.deletions ?? 0}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-1.5">
                <IndianRupee className="h-4 w-4 text-primary" /> Invoices
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {contract.invoices.map(inv => (
                  <div key={inv.id} className="text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{inv.number}</span>
                      <Badge variant="outline" className="text-[10px]">{inv.status}</Badge>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {formatINR(inv.total)} · issued {formatDate(inv.issueDate)}
                    </div>
                    <ul className="mt-1 ml-2 text-[10px] text-muted-foreground space-y-0.5">
                      {inv.lines.map(l => (
                        <li key={l.id}>· {l.description} — {formatINR(l.amount)}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
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
    <div className={`rounded-lg border p-3 text-center ${tone === 'emerald' ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30' : 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30'}`}>
      <div className={`mx-auto h-7 w-7 rounded-md flex items-center justify-center mb-1.5 ${tone === 'emerald' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="text-xs font-medium">{title}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
    </div>
  )
}

function FlowArrow() {
  return (
    <div className="hidden md:flex items-center justify-center text-muted-foreground">
      <ArrowRight className="h-3.5 w-3.5" />
    </div>
  )
}
