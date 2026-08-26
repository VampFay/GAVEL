'use client'

import { useEffect, useState, useRef } from 'react'
import { useAppStore } from '@/stores/app-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell, Legend, LineChart, Line, CartesianGrid,
} from 'recharts'
import {
  IndianRupee,
  ClipboardCheck,
  Activity,
  ShieldCheck,
  ArrowRight,
  CheckCircle2,
  XCircle,
  AlertCircle,
  FileSearch,
  RotateCw,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  formatINRCompact, formatINR, timeAgo, findingTypeLabel,
  statusColor, confidenceColor,
} from '@/lib/shipledger'
import { apiGet } from '@/lib/fetch'

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

const TYPE_COLORS = ['oklch(0.45 0.13 158)', 'oklch(0.7 0.13 75)', 'oklch(0.55 0.22 22)', 'oklch(0.6 0.1 200)', 'oklch(0.55 0.08 280)']

export function DashboardView() {
  const { setView, openIntake } = useAppStore()
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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-md" />)}
        </div>
        <Skeleton className="h-72 rounded-md mt-6" />
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
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Forensic recovery across {k.auditedCount} audited client{ k.auditedCount === 1 ? '' : 's'} · {k.monitoredProjects} project{k.monitoredProjects === 1 ? '' : 's'} under continuous monitoring
          </p>
        </div>
        <Button onClick={openIntake} className="bg-primary text-primary-foreground hover:bg-primary/90">
          <FileSearch className="h-4 w-4 mr-1.5" />
          Run new audit
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <KpiCard
          icon={IndianRupee}
          label="Total unbilled identified"
          value={formatINRCompact(k.totalImpact)}
          sub={`${formatINR(k.approvedImpact)} approved`}
          tone="primary"
        />
        <KpiCard
          icon={ClipboardCheck}
          label="Pending review"
          value={String(k.pendingReview)}
          sub={`${k.totalFindings} findings total`}
          tone="amber"
        />
        <KpiCard
          icon={FileSearch}
          label="Audits completed"
          value={String(k.auditedCount)}
          sub="across dev/IT-services firms"
        />
        <KpiCard
          icon={Activity}
          label="Projects monitored"
          value={String(k.monitoredProjects)}
          sub="real-time alerts enabled"
          tone="primary"
        />
      </div>

      {/* Charts */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recovery by month */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Unbilled recovery — last 6 months</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.recoveryByMonth}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
                <YAxis tickFormatter={(v) => formatINRCompact(v as number).replace('₹', '₹')} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <Tooltip
                  formatter={(v: number) => [formatINR(v), 'Impact']}
                  contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px' }}
                />
                <Bar dataKey="impact" fill="oklch(0.45 0.13 158)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Confidence distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Findings by confidence</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={[
                    { name: 'HIGH', value: data.confidenceBuckets.HIGH, color: 'oklch(0.45 0.13 158)' },
                    { name: 'MEDIUM', value: data.confidenceBuckets.MEDIUM, color: 'oklch(0.7 0.13 75)' },
                    { name: 'LOW', value: data.confidenceBuckets.LOW, color: 'oklch(0.55 0.22 22)' },
                  ]}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={2}
                >
                  {[0,1,2].map(i => <Cell key={i} fill={['oklch(0.45 0.13 158)', 'oklch(0.7 0.13 75)', 'oklch(0.55 0.22 22)'][i]} />)}
                </Pie>
                <Legend iconType="circle" formatter={(v) => <span style={{ fontSize: 12 }}>{v}</span>} />
                <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px' }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Findings by type + recent activity */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Findings by type</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.findingsByType.map(f => ({ ...f, type: findingTypeLabel(f.type) }))} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickFormatter={(v) => formatINRCompact(v as number).replace('₹','₹')} />
                <YAxis dataKey="type" type="category" tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" width={130} />
                <Tooltip
                  formatter={(v: number) => [formatINR(v), 'Impact']}
                  contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px' }}
                />
                <Bar dataKey="impact" fill="oklch(0.45 0.13 158)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Recent alerts */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent alerts</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setView('monitoring')} className="text-primary">
              View all <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-3 max-h-72 overflow-y-auto scrollbar-thin">
            {data.recentAlerts.length === 0 && (
              <p className="text-xs text-muted-foreground">No alerts yet.</p>
            )}
            {data.recentAlerts.map(a => (
              <AlertRow key={a.id} alert={a} />
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Audit log */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-primary" /> Immutable audit log
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-xs">
            {data.recentActivity.map(l => (
              <div key={l.id} className="flex items-center gap-3 py-1.5 border-b border-border last:border-0">
                <code className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{l.action}</code>
                <span className="text-muted-foreground flex-1 truncate">{l.detail}</span>
                <span className="text-muted-foreground/70 shrink-0">{timeAgo(l.createdAt)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function KpiCard({
  icon: Icon, label, value, sub, tone,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub?: string
  tone?: 'primary' | 'amber'
}) {
  return (
    <Card className={tone === 'primary' ? 'border-primary/30 bg-primary/5' : tone === 'amber' ? 'border-amber-300/40 bg-amber-50 dark:bg-amber-950/20' : ''}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">{label}</span>
          <div className={`h-7 w-7 rounded-md flex items-center justify-center ${tone === 'primary' ? 'bg-primary/10 text-primary' : tone === 'amber' ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300' : 'bg-muted text-muted-foreground'}`}>
            <Icon className="h-3.5 w-3.5" />
          </div>
        </div>
        <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  )
}

function AlertRow({ alert }: { alert: { id: string; severity: string; category: string; message: string; createdAt: string } }) {
  const conf = alert.severity === 'critical' ? confidenceColor('LOW') : alert.severity === 'warning' ? confidenceColor('MEDIUM') : confidenceColor('HIGH')
  const Icon = alert.severity === 'critical' ? AlertCircle : alert.severity === 'warning' ? AlertCircle : CheckCircle2
  return (
    <div className="flex items-start gap-2.5 p-2 rounded-md border border-border bg-card/50">
      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${conf.text}`} />
      <div className="flex-1 min-w-0">
        <p className="text-xs leading-snug">{alert.message}</p>
        <p className="text-[10px] text-muted-foreground mt-1">{alert.category} · {timeAgo(alert.createdAt)}</p>
      </div>
    </div>
  )
}
