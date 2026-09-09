'use client'

import { useAppStore } from '@/stores/app-store'
import { AppShell } from '@/components/gavel/app-shell'
import { LandingView } from '@/components/gavel/landing-view'
import { DashboardView } from '@/components/gavel/dashboard-view'
import { AuditsView } from '@/components/gavel/audits-view'
import { AuditDetailView } from '@/components/gavel/audit-detail-view'
import { ReviewQueueView } from '@/components/gavel/review-queue-view'
import { FindingDetailView } from '@/components/gavel/finding-detail-view'
import { MonitoringView } from '@/components/gavel/monitoring-view'
import { PricingView } from '@/components/gavel/pricing-view'
import { IntakeModal } from '@/components/gavel/intake-modal'

export default function Home() {
  const { view } = useAppStore()

  return (
    <AppShell>
      {view === 'landing' && <LandingView />}
      {view === 'dashboard' && <DashboardView />}
      {view === 'audits' && <AuditsView />}
      {view === 'audit_detail' && <AuditDetailView />}
      {view === 'review_queue' && <ReviewQueueView />}
      {view === 'finding_detail' && <FindingDetailView />}
      {view === 'monitoring' && <MonitoringView />}
      {view === 'pricing' && <PricingView />}
      <IntakeModal />
    </AppShell>
  )
}
