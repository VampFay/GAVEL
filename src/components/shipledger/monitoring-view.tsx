'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent } from '@/components/ui/card'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ReferenceLine,
} from 'recharts'
import {
  Activity, AlertTriangle, AlertCircle, CheckCircle2,
  TrendingUp, TrendingDown, Bell, BellOff, Target, RotateCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { timeAgo } from '@/lib/shipledger'
import { apiGet, apiPatch } from '@/lib/fetch'
import { cn } from '@/lib/utils'

interface Monitored {
  monitoredProjectId: string
  projectId: string
  projectName: string
  clientName: string
  contractTitle: string | null
  baseline: number
  startedAt: string
  alertsEnabled: boolean
  hasRealDriftData: boolean
  alerts: Array<{
    id: string
    severity: string
    category: string
    message: string
    createdAt: string
    acknowledged: boolean
  }>
  driftSeries: Array<{
    weekLabel: string
    deliveryToBilling: number
    deliveryHours: number
    billedHours: number
  }>
}

export function MonitoringView() {
  const [data, setData] = useState<Monitored[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    const { data: d, error: e } = await apiGet<{ monitored: Monitored[] }>('/api/monitoring', ctrl.signal)
    if (e) {
      setError(e.message)
      toast.error('Failed to load monitoring data', { description: e.message })
    } else if (d) {
      setData(d.monitored)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    return () => abortRef.current?.abort()
  }, [load])

  const ackAlert = async (alertId: string) => {
    // The route's [id] param IS the alert id for action:'ack' (see
    // PATCH /api/monitoring/[id]). The previous implementation sent the
    // MONITORED-PROJECT id in the path and never sent the alert id — every
    // Ack click failed with 404 "record not found".
    const { error: e } = await apiPatch(`/api/monitoring/${alertId}`, {
      action: 'ack',
      acknowledged: true,
    })
    if (e) {
      toast.error('Failed to acknowledge alert', { description: e.message })
      return
    }
    toast.success('Alert acknowledged', { description: 'Logged in the audit trail.' })
    setData(prev => prev?.map(m => ({
      ...m,
      alerts: m.alerts.map(a => a.id === alertId ? { ...a, acknowledged: true } : a),
    })) ?? null)
  }

  const toggleAlerts = async (monitoredId: string, enabled: boolean) => {
    const { error: e } = await apiPatch(`/api/monitoring/${monitoredId}`, {
      action: 'toggle',
      alertsEnabled: enabled,
    })
    if (e) {
      toast.error('Failed to toggle alerts', { description: e.message })
      return
    }
    toast.success(`Alerts ${enabled ? 'enabled' : 'disabled'}`)
    setData(prev => prev?.map(m => m.monitoredProjectId === monitoredId ? { ...m, alertsEnabled: enabled } : m) ?? null)
  }

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-3" aria-busy="true">
        <Skeleton className="h-20 rounded-md" />
        <Skeleton className="h-72 w-full rounded-md" />
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
            <p className="text-sm font-medium">Couldn&apos;t load monitoring data</p>
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

  const totalAlerts = data?.reduce((s, m) => s + m.alerts.filter(a => !a.acknowledged).length, 0) ?? 0
  const critical = data?.reduce((s, m) => s + m.alerts.filter(a => a.severity === 'critical' && !a.acknowledged).length, 0) ?? 0
  const driftAvg = data && data.length
    ? (data.reduce((s, m) => {
        const last = m.driftSeries.at(-1)
        return s + (last ? last.deliveryToBilling : m.baseline)
      }, 0) / data.length).toFixed(2)
    : '—'

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Scope line */}
      <p className="text-sm text-muted-foreground mb-4">
        {data?.length ?? 0} project{(data?.length ?? 0) === 1 ? '' : 's'} under continuous reconciliation ·{' '}
        <span className={cn('num font-semibold', totalAlerts > 0 ? 'text-foreground' : 'text-muted-foreground')}>{totalAlerts}</span>{' '}
        active alert{totalAlerts === 1 ? '' : 's'}
        {critical > 0 && <span className="text-rose-600 dark:text-rose-400"> · <span className="num font-semibold">{critical}</span> critical</span>}
      </p>

      {/* Console strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 border border-border rounded-md divide-x divide-y lg:divide-y-0 divide-border bg-card overflow-hidden stagger">
        <ConsoleCell icon={Activity} label="Projects monitored" value={String(data?.length ?? 0)} tone="primary" />
        <ConsoleCell icon={AlertTriangle} label="Active alerts" value={String(totalAlerts)} tone={totalAlerts > 0 ? 'amber' : undefined} />
        <ConsoleCell icon={AlertCircle} label="Critical" value={String(critical)} tone={critical > 0 ? 'rose' : undefined} />
        <ConsoleCell icon={Target} label="Latest drift" value={driftAvg} suffix="D/B" />
      </div>

      {data?.length === 0 && (
        <div className="mt-6 border border-dashed rounded-md">
          <div className="p-10 text-center">
            <div className="h-12 w-12 rounded-full bg-muted text-muted-foreground flex items-center justify-center mx-auto mb-3">
              <BellOff className="h-5 w-5" />
            </div>
            <p className="text-sm text-muted-foreground">No projects under monitoring yet. Convert an audit client to a monitoring subscription to enable live connectors and real-time alerts.</p>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-4 stagger">
        {data?.map(m => {
          const latest = m.driftSeries.at(-1)
          const driftVsBaseline = latest ? latest.deliveryToBilling - m.baseline : 0
          const trendUp = driftVsBaseline > 0
          const unacked = m.alerts.filter(a => !a.acknowledged).length
          return (
            <section key={m.monitoredProjectId} className="border border-border rounded-md bg-card">
              {/* Project header rule */}
              <div className="border-b border-border px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="micro flex items-center gap-2 flex-wrap">
                    <span>{m.clientName}</span>
                    <span className="text-border">·</span>
                    <span className="truncate max-w-[280px]">{m.contractTitle}</span>
                    {unacked > 0 && (
                      <span className="anim-breathe rounded-sm bg-rose-500/10 text-rose-600 dark:text-rose-400 px-1.5 py-px normal-case tracking-normal num text-[10px] font-semibold">
                        {unacked} open
                      </span>
                    )}
                  </div>
                  <h2 className="mt-1 text-[15px] font-semibold tracking-tight">{m.projectName}</h2>
                  <p className="num text-[11px] text-muted-foreground mt-0.5">
                    monitored since {new Date(m.startedAt).toLocaleDateString('en-IN')} · baseline {m.baseline.toFixed(2)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {(m.hasRealDriftData && driftVsBaseline !== 0) && (
                    <span className={cn(
                      'num inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-sm border',
                      trendUp
                        ? 'border-rose-300 text-rose-700 dark:text-rose-300'
                        : 'border-emerald-300 text-emerald-700 dark:text-emerald-300'
                    )}>
                      {trendUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {trendUp ? '+' : ''}{driftVsBaseline.toFixed(2)} σ drift
                    </span>
                  )}
                  <div className="flex items-center gap-2">
                    <Bell className={cn('h-3.5 w-3.5', m.alertsEnabled ? 'text-primary' : 'text-muted-foreground/50')} />
                    <Switch
                      checked={m.alertsEnabled}
                      onCheckedChange={(checked) => toggleAlerts(m.monitoredProjectId, checked)}
                      aria-label={`Toggle alerts for ${m.projectName}`}
                    />
                  </div>
                </div>
              </div>

              <div className="p-4">
                {/* Drift chart — only render when real data exists */}
                <div className="mb-4" role="region" aria-label={`Weekly drift chart for ${m.projectName}`}>
                  <div className="micro mb-2">Weekly delivery-to-billing ratio</div>
                  {m.hasRealDriftData && m.driftSeries.length > 0 ? (
                    <ResponsiveContainer width="100%" height={180}>
                      <LineChart data={m.driftSeries} role="img" aria-label={`Drift chart for ${m.projectName}: latest value ${latest?.deliveryToBilling.toFixed(2)}`}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="weekLabel" tick={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)' }} stroke="var(--muted-foreground)" />
                        <YAxis tick={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)' }} stroke="var(--muted-foreground)" domain={[0.6, 1.8]} />
                        <Tooltip
                          contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '12px' }}
                          formatter={(v: number) => [(v as number).toFixed(2), 'D/B ratio']}
                        />
                        <ReferenceLine y={m.baseline} stroke="var(--muted-foreground)" strokeDasharray="4 4" label={{ value: 'baseline', fontSize: 10, fill: 'var(--muted-foreground)' }} />
                        <ReferenceLine y={1.2} stroke="oklch(0.7 0.13 75)" strokeDasharray="2 2" label={{ value: 'warning', fontSize: 10, fill: 'oklch(0.5 0.13 75)' }} />
                        <ReferenceLine y={1.5} stroke="oklch(0.55 0.22 22)" strokeDasharray="2 2" label={{ value: 'critical', fontSize: 10, fill: 'oklch(0.5 0.22 22)' }} />
                        <Line type="monotone" dataKey="deliveryToBilling" stroke="var(--primary)" strokeWidth={2} dot={{ r: 2 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-32 flex items-center justify-center text-xs text-muted-foreground border border-dashed border-border rounded-md">
                      <div className="text-center max-w-md">
                        <BellOff className="h-4 w-4 mx-auto mb-2 opacity-50" />
                        No drift snapshots yet — weekly snapshots start once the
                        monitoring connectors go live (roadmap, §9.5). Nothing is
                        simulated here.
                      </div>
                    </div>
                  )}
                </div>

                {/* Hours comparison — only when real data exists */}
                {m.hasRealDriftData && latest && (
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="p-3 rounded-md border border-border bg-muted/30">
                      <div className="micro">Delivery hours (latest week)</div>
                      <div className="num text-lg font-semibold mt-0.5">{latest.deliveryHours ?? '—'}</div>
                    </div>
                    <div className="p-3 rounded-md border border-border bg-muted/30">
                      <div className="micro">Billed hours (latest week)</div>
                      <div className="num text-lg font-semibold mt-0.5">{latest.billedHours ?? '—'}</div>
                    </div>
                  </div>
                )}

                {/* Alert console */}
                <div>
                  <div className="micro mb-1.5">Alert log</div>
                  <div className="max-h-72 overflow-y-auto scrollbar-thin divide-y divide-border border-t border-border stagger-fast" role="log" aria-label={`Alerts for ${m.projectName}`}>
                    {m.alerts.length === 0 && (
                      <p className="text-xs text-muted-foreground py-3">No alerts — drift is within baseline.</p>
                    )}
                    {m.alerts.map(a => {
                      const Icon = a.severity === 'critical' ? AlertCircle : a.severity === 'warning' ? AlertTriangle : CheckCircle2
                      const spine = a.severity === 'critical' ? 'border-l-rose-500' : a.severity === 'warning' ? 'border-l-amber-500' : 'border-l-emerald-600'
                      const tone = a.severity === 'critical' ? 'text-rose-600 dark:text-rose-400' : a.severity === 'warning' ? 'text-amber-600 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-300'
                      return (
                        <div key={a.id} className={cn(
                          'flex items-start gap-2.5 py-2.5 pl-3 border-l-[3px] transition-opacity',
                          spine,
                          a.acknowledged && 'opacity-50'
                        )}>
                          <Icon className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', tone, a.severity === 'critical' && !a.acknowledged && 'anim-breathe')} aria-hidden="true" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs leading-snug">{a.message}</p>
                            <p className="micro mt-0.5">{a.category} · <span className="num lowercase tracking-normal">{timeAgo(a.createdAt)}</span></p>
                          </div>
                          {a.acknowledged ? (
                            <span className="micro normal-case tracking-normal text-muted-foreground/60 shrink-0">ack&apos;d</span>
                          ) : (
                            <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] shrink-0" onClick={() => ackAlert(a.id)}>
                              Ack
                            </Button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function ConsoleCell({ icon: Icon, label, value, tone, suffix }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  tone?: 'primary' | 'amber' | 'rose'
  suffix?: string
}) {
  return (
    <div className="p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="micro">{label}</span>
        <Icon
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            tone === 'primary' ? 'text-primary' : tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : tone === 'rose' ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground/60'
          )}
          aria-hidden="true"
        />
      </div>
      <div className={cn(
        'num mt-2 text-2xl font-semibold tracking-tight leading-none',
        tone === 'amber' && 'text-amber-600 dark:text-amber-400',
        tone === 'rose' && 'text-rose-600 dark:text-rose-400'
      )}>
        {value}
        {suffix && <span className="text-[11px] font-normal text-muted-foreground ml-1.5">{suffix}</span>}
      </div>
    </div>
  )
}
