'use client'

import { useAppStore } from '@/stores/app-store'
import { AppShell } from '@/components/shipledger/app-shell'
import { LandingView } from '@/components/shipledger/landing-view'
import { DashboardView } from '@/components/shipledger/dashboard-view'
import { AuditsView } from '@/components/shipledger/audits-view'
import { AuditDetailView } from '@/components/shipledger/audit-detail-view'
import { ReviewQueueView } from '@/components/shipledger/review-queue-view'
import { FindingDetailView } from '@/components/shipledger/finding-detail-view'
import { MonitoringView } from '@/components/shipledger/monitoring-view'
import { PricingView } from '@/components/shipledger/pricing-view'
import { IntakeModal } from '@/components/shipledger/intake-modal'

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
