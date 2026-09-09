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

export type NavDir = 'forward' | 'backward'

/* Binder order — the position of each view along the rail. Navigation
   down the rail turns the case file's page forward (content enters from
   the right); navigation up turns it back (enters from the left).
   Detail views sit one notch deeper than their list view. */
const VIEW_ORDER: Record<View, number> = {
  landing: 7,
  dashboard: 1,
  audits: 2,
  audit_detail: 3,
  review_queue: 4,
  finding_detail: 5,
  monitoring: 6,
  pricing: 8,
}

/* Findings a reviewer has ruled on, for the verdict flash overlay. */
export interface VerdictFlash {
  status: 'approved' | 'dismissed' | 'escalated'
  /** Increments per trigger so identical consecutive rulings re-play. */
  key: number
}

interface AppState {
  view: View
  activeAuditId: string | null
  activeFindingId: string | null
  intakeOpen: boolean
  /** Direction of the last navigation (binder page-turn). */
  navDir: NavDir
  /** Present while a verdict flash should be on screen; null otherwise. */
  verdictFlash: VerdictFlash | null

  setView: (v: View) => void
  openAudit: (id: string) => void
  openFinding: (id: string) => void
  openIntake: () => void
  closeIntake: () => void
  triggerVerdictFlash: (status: VerdictFlash['status']) => void
  clearVerdictFlash: () => void
}

const dirFor = (next: View, prev: View): NavDir =>
  VIEW_ORDER[next] >= VIEW_ORDER[prev] ? 'forward' : 'backward'

export const useAppStore = create<AppState>((set) => ({
  view: 'landing',
  activeAuditId: null,
  activeFindingId: null,
  intakeOpen: false,
  navDir: 'forward',
  verdictFlash: null,

  setView: (v) => set((s) => ({ view: v, navDir: dirFor(v, s.view) })),
  openAudit: (id) => set((s) => ({ view: 'audit_detail', activeAuditId: id, navDir: dirFor('audit_detail', s.view) })),
  openFinding: (id) => set((s) => ({ view: 'finding_detail', activeFindingId: id, navDir: dirFor('finding_detail', s.view) })),
  openIntake: () => set({ intakeOpen: true }),
  closeIntake: () => set({ intakeOpen: false }),
  triggerVerdictFlash: (status) =>
    set((s) => ({ verdictFlash: { status, key: (s.verdictFlash?.key ?? 0) + 1 } })),
  clearVerdictFlash: () => set({ verdictFlash: null }),
}))
