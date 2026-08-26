'use client'

import { useEffect, useState, useRef } from 'react'
import { useAppStore } from '@/stores/app-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  FileSearch,
  ArrowRight,
  IndianRupee,
  ClipboardCheck,
  Activity,
  Building2,
  Plus,
  AlertCircle,
  RotateCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatINR, formatINRCompact, formatDate } from '@/lib/shipledger'
import { apiGet } from '@/lib/fetch'

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
        <Skeleton className="h-12 w-full" />
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
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
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audits</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {audits.length} client{audits.length === 1 ? '' : 's'} · {formatINRCompact(totalImpact)} unbilled identified · {formatINRCompact(totalApproved)} approved · {totalPending} pending review
          </p>
        </div>
        <Button onClick={openIntake} className="bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4 mr-1.5" />
          New audit
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {audits.map(a => (
          <Card key={a.clientId} className="hover:border-primary/40 transition-colors cursor-pointer" >
            <button
              className="text-left w-full"
              onClick={() => a.contractId && a.projectId && openAudit(a.clientId)}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Building2 className="h-3 w-3" />
                      <span>{a.clientName}</span>
                      {a.sizeBand && <Badge variant="outline" className="text-[10px]">{a.sizeBand}</Badge>}
                      {a.monitored && (
                        <Badge className="text-[10px] bg-primary/10 text-primary border border-primary/20">
                          <Activity className="h-2.5 w-2.5 mr-0.5" /> Monitored
                        </Badge>
                      )}
                    </div>
                    <h3 className="font-medium text-sm mt-1.5 truncate">{a.contractTitle ?? '—'}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {a.projectName} · {a.projectStatus} · {formatDate(a.effectiveDate)} → {formatDate(a.endDate)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-lg font-semibold text-primary">{formatINRCompact(a.totalImpact)}</div>
                    <div className="text-[10px] text-muted-foreground">unbilled identified</div>
                  </div>
                </div>

                {/* Findings breakdown bar */}
                <div className="mt-4">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1.5">
                    <span>Findings ({a.findingsCount})</span>
                    <span>{formatINR(a.approvedImpact)} approved</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden flex">
                    <div className="bg-emerald-500" style={{ width: `${pct(a.approved, a.findingsCount)}%` }} />
                    <div className="bg-amber-500" style={{ width: `${pct(a.pendingReview, a.findingsCount)}%` }} />
                    <div className="bg-rose-500" style={{ width: `${pct(a.escalated, a.findingsCount)}%` }} />
                    <div className="bg-slate-300 dark:bg-slate-700" style={{ width: `${pct(a.dismissed, a.findingsCount)}%` }} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
                    <span><span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1" />{a.approved} approved</span>
                    <span><span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 mr-1" />{a.pendingReview} pending</span>
                    <span><span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-500 mr-1" />{a.escalated} escalated</span>
                    <span><span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400 mr-1" />{a.dismissed} dismissed</span>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">
                    Contract value: <span className="text-foreground font-medium">{formatINRCompact(a.totalValue)}</span>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs text-primary">
                    Open case file <ArrowRight className="h-3 w-3" />
                  </span>
                </div>
              </CardContent>
            </button>
          </Card>
        ))}
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
    <Card className="border-dashed">
      <CardContent className="p-10 text-center">
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
      </CardContent>
    </Card>
  )
}
