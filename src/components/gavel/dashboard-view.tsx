'use client'

import { useEffect, useState, useRef } from 'react'
import { useAppStore } from '@/stores/app-store'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell, Legend, CartesianGrid,
} from 'recharts'
import {
  IndianRupee,
  ClipboardCheck,
  Activity,
  ShieldCheck,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  FileSearch,
  RotateCw,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  formatINRCompact, formatINR, timeAgo, findingTypeLabel,
  confidenceColor,
} from '@/lib/gavel'
import { apiGet } from '@/lib/fetch'
import { cn } from '@/lib/utils'
import { CountUp } from './count-up'

interface DashboardData {
  ok: boolean
  kpis: {
    totalImpact: number
    approvedImpact: number
    pendingReview: number
    auditedCount: number
    monitoredProjects: number
    totalFindings: number
  }
  findingsByType: { type: string; count: number; impact: number }[]
  confidenceBuckets: { HIGH: number; MEDIUM: number; LOW: number }
  recoveryByMonth: { label: string; impact: number }[]
  recentAlerts: {
    id: string
    severity: string
    category: string
    message: string
    createdAt: string
  }[]
  recentActivity: {
    id: string
    actor: string
    action: string
    detail: string | null
    createdAt: string
  }[]
}

export function DashboardView() {
  const { setView } = useAppStore()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    const { data: d, error: e } = await apiGet<DashboardData>('/api/dashboard', ctrl.signal)
    if (e) {
      setError(e.message)
      toast.error('Failed to load dashboard', { description: e.message })
    } else if (d) {
      setData(d)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    return () => abortRef.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading || !data) {
    return (
      <div className="p-6 max-w-7xl mx-auto" aria-busy="true">
        <Skeleton className="skeleton-ink h-20 rounded-md" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
          <Skeleton className="skeleton-ink h-64 rounded-md lg:col-span-2" />
          <Skeleton className="skeleton-ink h-64 rounded-md" />
        </div>
        <Skeleton className="skeleton-ink h-40 rounded-md mt-4" />
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
            <p className="text-sm font-medium">Couldn&apos;t load dashboard</p>
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

  const k = data.kpis

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Scope line — the case-file cover note */}
      <p className="anim-row-in text-sm text-muted-foreground mb-4">
        Forensic recovery across{' '}
        <span className="num font-semibold text-foreground">{k.auditedCount}</span>{' '}
        audited client{k.auditedCount === 1 ? '' : 's'} ·{' '}
        <span className="num font-semibold text-foreground">{k.monitoredProjects}</span>{' '}
        project{k.monitoredProjects === 1 ? '' : 's'} under monitoring
      </p>

      {/* KPI band — one instrument strip, hairline-divided; the money
          counts up like an adding machine running a tape */}
      <div className="grid grid-cols-2 lg:grid-cols-4 border border-border rounded-md divide-x divide-y lg:divide-y-0 divide-border bg-card overflow-hidden stagger">
        <KpiCell
          icon={IndianRupee}
          label="Unbilled identified"
          value={<CountUp value={k.totalImpact} format={formatINRCompact} />}
          sub={`${formatINR(k.approvedImpact)} approved`}
          tone="primary"
        />
        <KpiCell
          icon={ClipboardCheck}
          label="Pending review"
          value={String(k.pendingReview)}
          sub={`${k.totalFindings} findings total`}
          tone={k.pendingReview > 0 ? 'amber' : undefined}
          onClick={() => setView('review_queue')}
        />
        <KpiCell
          icon={FileSearch}
          label="Audits completed"
          value={String(k.auditedCount)}
          sub="across dev/IT-services firms"
          onClick={() => setView('audits')}
        />
        <KpiCell
          icon={Activity}
          label="Projects monitored"
          value={String(k.monitoredProjects)}
          sub="drift alerts enabled"
          tone="primary"
          onClick={() => setView('monitoring')}
        />
      </div>

      {/* Charts row */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4 stagger">
        <Panel title="Unbilled recovery — last 6 months" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.recoveryByMonth}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)' }} stroke="var(--muted-foreground)" />
              <YAxis tickFormatter={(v) => formatINRCompact(v as number)} tick={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)' }} stroke="var(--muted-foreground)" width={72} />
              <Tooltip
                formatter={(v: number) => [formatINR(v), 'Impact']}
                contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '12px' }}
              />
              <Bar dataKey="impact" fill="oklch(0.45 0.13 158)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Findings by confidence">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={[
                  { name: 'HIGH', value: data.confidenceBuckets.HIGH, color: 'oklch(0.45 0.13 158)' },
                  { name: 'MEDIUM', value: data.confidenceBuckets.MEDIUM, color: 'oklch(0.7 0.13 75)' },
                  { name: 'LOW', value: data.confidenceBuckets.LOW, color: 'oklch(0.55 0.22 22)' },
                ]}
                dataKey="value"
                nameKey="name"
                innerRadius={52}
                outerRadius={80}
                paddingAngle={2}
              >
                {[0, 1, 2].map(i => <Cell key={i} fill={['oklch(0.45 0.13 158)', 'oklch(0.7 0.13 75)', 'oklch(0.55 0.22 22)'][i]} />)}
              </Pie>
              <Legend iconType="circle" formatter={(v) => <span style={{ fontSize: 12 }}>{v}</span>} />
              <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '12px' }} />
            </PieChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {/* Findings by type + recent alerts */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4 stagger">
        <Panel title="Findings by type" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.findingsByType.map(f => ({ ...f, type: findingTypeLabel(f.type) }))} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)' }} stroke="var(--muted-foreground)" tickFormatter={(v) => formatINRCompact(v as number)} />
              <YAxis dataKey="type" type="category" tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" width={130} />
              <Tooltip
                formatter={(v: number) => [formatINR(v), 'Impact']}
                contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '12px' }}
              />
              <Bar dataKey="impact" fill="oklch(0.45 0.13 158)" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel
          title="Recent alerts"
          action={{ label: 'View all', onClick: () => setView('monitoring') }}
        >
          <div className="max-h-64 overflow-y-auto scrollbar-thin -mx-1 px-1">
            {data.recentAlerts.length === 0 && (
              <p className="text-xs text-muted-foreground">No alerts yet.</p>
            )}
            <div className="divide-y divide-border">
              {data.recentAlerts.map(a => (
                <AlertLine key={a.id} alert={a} />
              ))}
            </div>
          </div>
        </Panel>
      </div>

      {/* Audit log — the forensic exhibit; entries riffle in like a
          stack being dealt */}
      <Panel
        title="Immutable audit log"
        icon={<ShieldCheck className="h-3.5 w-3.5 text-primary" />}
        className="mt-4 anim-panel-in"
      >
        <div className="divide-y divide-border stagger-fast">
          {data.recentActivity.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">No activity recorded yet.</p>
          )}
          {data.recentActivity.map(l => (
            <div key={l.id} className="flex items-center gap-3 py-2 text-xs">
              <span className="num text-[10px] text-muted-foreground/70 shrink-0 w-16">{timeAgo(l.createdAt)}</span>
              <code className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground shrink-0">{l.action}</code>
              <span className="text-muted-foreground/80 shrink-0 hidden sm:inline w-32 truncate">{l.actor}</span>
              <span className="text-muted-foreground flex-1 truncate">{l.detail}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}

/* Panel — the workbench section: hairline box + micro header rule */
function Panel({ title, icon, action, className, children }: {
  title: string
  icon?: React.ReactNode
  action?: { label: string; onClick: () => void }
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn('border border-border rounded-md bg-card', className)}>
      <div className="border-b border-border px-4 py-2.5 flex items-center justify-between gap-2">
        <h2 className="micro flex items-center gap-1.5">{icon}{title}</h2>
        {action && (
          <Button variant="ghost" size="sm" onClick={action.onClick} className="h-6 px-2 text-xs text-primary">
            {action.label} <ArrowRight className="h-3 w-3 ml-0.5" />
          </Button>
        )}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function KpiCell({
  icon: Icon, label, value, sub, tone, onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: React.ReactNode
  sub?: string
  tone?: 'primary' | 'amber'
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'p-4 text-left transition-colors',
        onClick && 'cursor-pointer hover:bg-muted/50'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="micro">{label}</span>
        <Icon
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            tone === 'primary' ? 'text-primary' : tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground/60'
          )}
        />
      </div>
      <div className={cn(
        'num mt-2 text-2xl font-semibold tracking-tight leading-none',
        tone === 'amber' && 'text-amber-600 dark:text-amber-400'
      )}>
        {value}
      </div>
      {sub && <div className="num text-[11px] text-muted-foreground mt-1.5">{sub}</div>}
    </button>
  )
}

function AlertLine({ alert }: { alert: { id: string; severity: string; category: string; message: string; createdAt: string } }) {
  const conf = alert.severity === 'critical' ? confidenceColor('LOW') : alert.severity === 'warning' ? confidenceColor('MEDIUM') : confidenceColor('HIGH')
  const Icon = alert.severity === 'critical' || alert.severity === 'warning' ? AlertCircle : CheckCircle2
  return (
    <div className="flex items-start gap-2.5 py-2">
      <Icon className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', conf.text)} />
      <div className="flex-1 min-w-0">
        <p className="text-xs leading-snug">{alert.message}</p>
        <p className="micro mt-0.5">{alert.category} · {timeAgo(alert.createdAt)}</p>
      </div>
    </div>
  )
}
