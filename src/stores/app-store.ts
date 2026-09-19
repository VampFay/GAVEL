'use client'

import { create } from 'zustand'

export type View =
  | 'landing'
  | 'dashboard'
  | 'audits'
  | 'audit_detail'
  | 'review_queue'
  | 'finding_detail'
  | 'monitoring'
  | 'pricing'
  | 'team'

interface AppState {
  view: View
  activeAuditId: string | null
  activeFindingId: string | null
  intakeOpen: boolean

  setView: (v: View) => void
  openAudit: (id: string) => void
  openFinding: (id: string) => void
  openIntake: () => void
  closeIntake: () => void
}

export const useAppStore = create<AppState>((set) => ({
  view: 'landing',
  activeAuditId: null,
  activeFindingId: null,
  intakeOpen: false,

  setView: (v) => set({ view: v }),
  openAudit: (id) => set({ view: 'audit_detail', activeAuditId: id }),
  openFinding: (id) => set({ view: 'finding_detail', activeFindingId: id }),
  openIntake: () => set({ intakeOpen: true }),
  closeIntake: () => set({ intakeOpen: false }),
}))
