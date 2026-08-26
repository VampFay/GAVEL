'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ReferenceLine, Legend,
} from 'recharts'
import {
  Activity, AlertTriangle, AlertCircle, CheckCircle2,
  TrendingUp, TrendingDown, Bell, BellOff, Target,
} from 'lucide-react'
import { toast } from 'sonner'
import { timeAgo } from '@/lib/shipledger'

interface Monitored {
  monitoredProjectId: string
  projectId: string
  projectName: string
  clientName: string
  contractTitle: string | null
  baseline: number
  startedAt: string
  alertsEnabled: boolean
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

  const load = () => {
    setLoading(true)
    fetch('/api/monitoring')
      .then(r => r.json())
      .then(d => {
        setData(d.monitored)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const ackAlert = async (id: string) => {
    // For demo — fire-and-forget toast (would PATCH in production)
    toast.success('Alert acknowledged', { description: 'Marked read in the audit log.' })
    setData(prev => prev?.map(m => ({
      ...m,
      alerts: m.alerts.map(a => a.id === id ? { ...a, acknowledged: true } : a),
    })) ?? null)
  }

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  const totalAlerts = data?.reduce((s, m) => s + m.alerts.filter(a => !a.acknowledged).length, 0) ?? 0
  const critical = data?.reduce((s, m) => s + m.alerts.filter(a => a.severity === 'critical' && !a.acknowledged).length, 0) ?? 0

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Monitoring</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data?.length ?? 0} project{(data?.length ?? 0) === 1 ? '' : 's'} under continuous reconciliation · {totalAlerts} active alert{totalAlerts === 1 ? '' : 's'}{critical > 0 && <span className="text-rose-600 dark:text-rose-400"> · {critical} critical</span>}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
        <StatTile icon={Activity} label="Projects monitored" value={String(data?.length ?? 0)} tone="primary" />
        <StatTile icon={AlertTriangle} label="Active alerts" value={String(totalAlerts)} tone="amber" />
        <StatTile icon={AlertCircle} label="Critical" value={String(critical)} tone="rose" />
        <StatTile icon={Target} label="Avg drift" value={data && data.length ? (data.reduce((s, m) => s + (m.driftSeries.at(-1)?.deliveryToBilling ?? m.baseline), 0) / data.length).toFixed(2) : '—'} />
      </div>

      {data?.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="p-10 text-center">
            <div className="h-12 w-12 rounded-full bg-muted text-muted-foreground flex items-center justify-center mx-auto mb-3">
              <BellOff className="h-5 w-5" />
            </div>
            <p className="text-sm text-muted-foreground">No projects under monitoring yet. Convert an audit client to a monitoring subscription to enable live connectors and real-time alerts.</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-6">
        {data?.map(m => {
          const latest = m.driftSeries.at(-1)
          const driftVsBaseline = latest ? latest.deliveryToBilling - m.baseline : 0
          const trendUp = driftVsBaseline > 0
          return (
            <Card key={m.monitoredProjectId}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{m.clientName}</span>
                      <Separator orientation="vertical" className="h-3" />
                      <span>{m.contractTitle}</span>
                    </div>
                    <CardTitle className="text-base mt-1">{m.projectName}</CardTitle>
                    <CardDescription className="text-xs">
                      Monitoring since {new Date(m.startedAt).toLocaleDateString('en-IN')} · baseline delivery-to-billing ratio: {m.baseline.toFixed(2)}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-3">
                    {driftVsBaseline !== 0 && (
                      <Badge variant="outline" className={`text-[10px] ${trendUp ? 'border-rose-300 text-rose-700 dark:text-rose-300' : 'border-emerald-300 text-emerald-700 dark:text-emerald-300'}`}>
                        {trendUp ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                        {trendUp ? '+' : ''}{driftVsBaseline.toFixed(2)} σ drift
                      </Badge>
                    )}
                    <div className="flex items-center gap-2">
                      <Bell className={`h-3.5 w-3.5 ${m.alertsEnabled ? 'text-primary' : 'text-muted-foreground'}`} />
                      <Switch checked={m.alertsEnabled} />
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* Drift chart */}
                <div className="mb-4">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Weekly delivery-to-billing ratio</div>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={m.driftSeries}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                      <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" domain={[0.6, 1.8]} />
                      <Tooltip
                        contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px' }}
                        formatter={(v: number) => [(v as number).toFixed(2), 'D/B ratio']}
                      />
                      <ReferenceLine y={m.baseline} stroke="var(--muted-foreground)" strokeDasharray="4 4" label={{ value: 'baseline', fontSize: 10, fill: 'var(--muted-foreground)' }} />
                      <ReferenceLine y={1.2} stroke="oklch(0.7 0.13 75)" strokeDasharray="2 2" label={{ value: 'warning', fontSize: 10, fill: 'oklch(0.5 0.13 75)' }} />
                      <ReferenceLine y={1.5} stroke="oklch(0.55 0.22 22)" strokeDasharray="2 2" label={{ value: 'critical', fontSize: 10, fill: 'oklch(0.5 0.22 22)' }} />
                      <Line type="monotone" dataKey="deliveryToBilling" stroke="var(--primary)" strokeWidth={2} dot={{ r: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Hours comparison */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="p-3 rounded border border-border bg-muted/30">
                    <div className="text-[10px] text-muted-foreground uppercase">Delivery hours (latest week)</div>
                    <div className="text-lg font-semibold mt-0.5">{latest?.deliveryHours ?? '—'}</div>
                  </div>
                  <div className="p-3 rounded border border-border bg-muted/30">
                    <div className="text-[10px] text-muted-foreground uppercase">Billed hours (latest week)</div>
                    <div className="text-lg font-semibold mt-0.5">{latest?.billedHours ?? '—'}</div>
                  </div>
                </div>

                <Separator className="mb-3" />

                {/* Alerts */}
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Alerts</div>
                  <div className="space-y-2 max-h-72 overflow-y-auto scrollbar-thin">
                    {m.alerts.length === 0 && (
                      <p className="text-xs text-muted-foreground">No alerts — drift is within baseline.</p>
                    )}
                    {m.alerts.map(a => {
                      const Icon = a.severity === 'critical' ? AlertCircle : a.severity === 'warning' ? AlertTriangle : CheckCircle2
                      const tone = a.severity === 'critical' ? 'text-rose-600 dark:text-rose-400' : a.severity === 'warning' ? 'text-amber-600 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-300'
                      return (
                        <div key={a.id} className={`flex items-start gap-2 p-2 rounded border ${a.acknowledged ? 'opacity-50' : ''} border-border bg-card/50`}>
                          <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${tone}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs leading-snug">{a.message}</p>
                            <p className="text-[10px] text-muted-foreground mt-1">{a.category} · {timeAgo(a.createdAt)}</p>
                          </div>
                          {!a.acknowledged && (
                            <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => ackAlert(a.id)}>
                              Ack
                            </Button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function StatTile({ icon: Icon, label, value, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; tone?: 'primary' | 'amber' | 'rose' }) {
  return (
    <Card className={tone === 'primary' ? 'border-primary/30 bg-primary/5' : tone === 'amber' ? 'border-amber-300/40 bg-amber-50 dark:bg-amber-950/20' : tone === 'rose' ? 'border-rose-300/40 bg-rose-50 dark:bg-rose-950/20' : ''}>
      <CardContent className="p-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="text-xl font-semibold mt-0.5">{value}</div>
        </div>
        <div className={`h-8 w-8 rounded-md flex items-center justify-center ${tone === 'primary' ? 'bg-primary/10 text-primary' : tone === 'amber' ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300' : tone === 'rose' ? 'bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300' : 'bg-muted text-muted-foreground'}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </CardContent>
    </Card>
  )
}
