'use client'

import { useEffect, useState, useRef } from 'react'
import { useAppStore } from '@/stores/app-store'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  FileSearch,
  ArrowRight,
  Activity,
  Building2,
  Plus,
  AlertCircle,
  RotateCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatINR, formatINRCompact, formatDate } from '@/lib/gavel'
import { apiGet } from '@/lib/fetch'
import { cn } from '@/lib/utils'

interface Audit {
  clientId: string
  clientName: string
  industry: string | null
  sizeBand: string | null
  // contactName removed — PII; route no longer returns it.
  contractId: string | null
  contractTitle: string | null
  totalValue: number | null
  currency: string
  effectiveDate: string | null
  endDate: string | null
  projectId: string | null
  projectName: string | null
  projectStatus: string | null
  findingsCount: number
  pendingReview: number
  approved: number
  dismissed: number
  escalated: number
  totalImpact: number
  approvedImpact: number
  monitored: boolean
}

export function AuditsView() {
  const { openAudit, openIntake } = useAppStore()
  const [audits, setAudits] = useState<Audit[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    const { data: d, error: e } = await apiGet<{ audits: Audit[] }>('/api/audits', ctrl.signal)
    if (e) {
      setError(e.message)
      toast.error('Failed to load audits', { description: e.message })
    } else if (d) {
      setAudits(d.audits)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    return () => abortRef.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-3" aria-busy="true">
        <Skeleton className="h-14 rounded-md" />
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-md" />)}
      </div>
    )
  }

  if (error && !audits) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <Card className="border-rose-200 dark:border-rose-900">
          <CardContent className="p-8 text-center">
            <div className="h-12 w-12 mx-auto rounded-full bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 flex items-center justify-center mb-3">
              <AlertCircle className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium">Couldn&apos;t load audits</p>
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

  if (!audits || audits.length === 0) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <EmptyAudits onRun={openIntake} />
      </div>
    )
  }

  const totalImpact = audits.reduce((s, a) => s + a.totalImpact, 0)
  const totalApproved = audits.reduce((s, a) => s + a.approvedImpact, 0)
  const totalPending = audits.reduce((s, a) => s + a.pendingReview, 0)

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Scope line */}
      <p className="text-sm text-muted-foreground mb-4">
        {audits.length} engagement{audits.length === 1 ? '' : 's'} ·{' '}
        <span className="num font-semibold text-foreground">{formatINRCompact(totalImpact)}</span> unbilled identified ·{' '}
        <span className="num font-semibold text-foreground">{formatINRCompact(totalApproved)}</span> approved ·{' '}
        <span className="num font-semibold text-foreground">{totalPending}</span> pending review
      </p>

      {/* Engagement ledger */}
      <div className="border border-border rounded-md bg-card overflow-hidden">
        <div className="hidden md:grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_120px_140px] gap-4 items-center border-b border-border bg-muted/40 px-4 py-2">
          <span className="micro">Client / contract</span>
          <span className="micro">Findings</span>
          <span className="micro text-right">Unbilled</span>
          <span className="micro text-right">Contract value</span>
        </div>
        <div className="divide-y divide-border stagger-fast">
          {audits.map(a => {
            const openable = !!(a.contractId && a.projectId)
            return (
              <button
                key={a.clientId}
                className={cn(
                  'ledger-row w-full text-left px-4 py-3.5 transition-colors',
                  openable ? 'cursor-pointer hover:bg-muted/40' : 'cursor-default'
                )}
                onClick={() => openable && openAudit(a.clientId)}
                aria-label={`Open case file for ${a.clientName}`}
              >
                <div className="grid grid-cols-1 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_120px_140px] gap-3 md:gap-4 items-center">
                  {/* Client / contract */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="text-[13px] font-semibold truncate">{a.clientName}</span>
                      {a.sizeBand && <Badge variant="outline" className="text-[9px] px-1 py-0">{a.sizeBand}</Badge>}
                      {a.monitored && (
                        <Badge className="text-[9px] px-1.5 py-0 h-auto bg-primary/10 text-primary border border-primary/20">
                          <Activity className="h-2.5 w-2.5 mr-0.5" /> Monitored
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground truncate">
                      {a.contractTitle ?? '—'}
                      <span className="mx-1.5 text-border">·</span>
                      <span className="num text-[11px]">{formatDate(a.effectiveDate)} → {formatDate(a.endDate)}</span>
                    </div>
                  </div>

                  {/* Findings breakdown */}
                  <div className="min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="num text-[11px] text-muted-foreground">{a.findingsCount} findings</span>
                      <span className="num text-[10px] text-muted-foreground/80">{formatINR(a.approvedImpact)} approved</span>
                    </div>
                    <div className="h-1.5 bg-muted overflow-hidden flex rounded-[1px]">
                      <div className="bg-emerald-500" style={{ width: `${pct(a.approved, a.findingsCount)}%` }} />
                      <div className="bg-amber-500" style={{ width: `${pct(a.pendingReview, a.findingsCount)}%` }} />
                      <div className="bg-rose-500" style={{ width: `${pct(a.escalated, a.findingsCount)}%` }} />
                      <div className="bg-slate-300 dark:bg-slate-700" style={{ width: `${pct(a.dismissed, a.findingsCount)}%` }} />
                    </div>
                    <div className="num mt-1 text-[10px] text-muted-foreground">
                      <span className="text-emerald-600 dark:text-emerald-400">{a.approved}</span> ap
                      <span className="mx-1 text-border">/</span>
                      <span className="text-amber-600 dark:text-amber-400">{a.pendingReview}</span> pd
                      <span className="mx-1 text-border">/</span>
                      <span className="text-rose-600 dark:text-rose-400">{a.escalated}</span> es
                      <span className="mx-1 text-border">/</span>
                      <span className="text-muted-foreground">{a.dismissed}</span> dm
                    </div>
                  </div>

                  {/* Unbilled impact */}
                  <div className="md:text-right">
                    <div className="num text-lg font-semibold text-primary leading-none">{formatINRCompact(a.totalImpact)}</div>
                    <div className="micro mt-0.5">identified</div>
                  </div>

                  {/* Contract value + open affordance */}
                  <div className="md:text-right flex md:block items-center justify-between gap-2">
                    <div>
                      <div className="num text-lg font-semibold leading-none">{formatINRCompact(a.totalValue)}</div>
                      <div className="micro mt-0.5">contract</div>
                    </div>
                    {openable && (
                      <span className="hidden md:inline-flex items-center gap-1 text-xs text-primary">
                        Open <ArrowRight className="h-3 w-3" />
                      </span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function pct(n: number, total: number): number {
  if (!total) return 0
  return Math.round((n / total) * 100)
}

function EmptyAudits({ onRun }: { onRun: () => void }) {
  return (
    <div className="border border-dashed rounded-md">
      <div className="p-10 text-center">
        <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-4">
          <FileSearch className="h-5 w-5" />
        </div>
        <h3 className="font-medium">No audits yet</h3>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto">
          Start by running an audit against a client SOW. Paste the contract text, attach delivery exports,
          and let the forensic engine surface the gaps as evidence-backed findings.
        </p>
        <Button className="mt-5 bg-primary text-primary-foreground hover:bg-primary/90" onClick={onRun}>
          <Plus className="h-4 w-4 mr-1.5" />
          Run first audit
        </Button>
      </div>
    </div>
  )
}
