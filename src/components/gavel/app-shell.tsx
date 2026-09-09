'use client'

import { useEffect, useState } from 'react'
import { useAppStore, type View } from '@/stores/app-store'
import { Logo } from './logo'
import { ThemeToggle } from './theme-toggle'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  FileSearch,
  ClipboardCheck,
  Activity,
  Sparkles,
  RotateCw,
  Menu,
  X,
  ShieldCheck,
  ScanSearch,
  LogOut,
  UserCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import { apiGet } from '@/lib/fetch'

interface NavItem {
  view: View
  label: string
  icon: React.ComponentType<{ className?: string }>
  description: string
}

/* Rail is ordered by the analyst's actual workflow:
   intake → case overview → audits → triage → monitoring.
   Marketing surfaces (about/plans) sit below the workflow cut. */
const WORKFLOW: NavItem[] = [
  { view: 'dashboard', label: 'Case overview', icon: LayoutDashboard, description: 'Financial exposure & activity' },
  { view: 'audits', label: 'Audits', icon: FileSearch, description: 'Engagements & SOWs' },
  { view: 'review_queue', label: 'Review queue', icon: ClipboardCheck, description: 'Findings triage' },
  { view: 'monitoring', label: 'Monitoring', icon: Activity, description: 'Drift & alerts' },
]

const GENERAL: NavItem[] = [
  { view: 'landing', label: 'About', icon: Sparkles, description: 'What this tool is' },
  { view: 'pricing', label: 'Plans', icon: ShieldCheck, description: 'Tiers & limits' },
]

interface Me {
  user: { email: string; name: string | null; role: string } | null
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { view, setView, openIntake } = useAppStore()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [pending, setPending] = useState<number | null>(null)
  const [me, setMe] = useState<Me['user']>(null)

  /* Pending-review badge: refreshed on every view change so post-action
     counts stay honest (single SQLite count — cheap enough). */
  useEffect(() => {
    let alive = true
    apiGet<{ kpis: { pendingReview: number } }>('/api/dashboard').then(({ data }) => {
      if (alive && data?.kpis) setPending(data.kpis.pendingReview)
    })
    return () => { alive = false }
  }, [view])

  /* Identity from the verified session (anonymous in dev hatch). */
  useEffect(() => {
    let alive = true
    apiGet<Me>('/api/auth/me').then(({ data }) => {
      if (alive && data?.user) setMe(data.user)
    })
    return () => { alive = false }
  }, [])

  const activeLabel =
    view === 'audit_detail' ? 'Audits'
    : view === 'finding_detail' ? 'Review queue'
    : WORKFLOW.find(i => i.view === view)?.label
      ?? GENERAL.find(i => i.view === view)?.label ?? ''

  const isActive = (item: View) =>
    view === item || (item === 'audits' && view === 'audit_detail') || (item === 'review_queue' && view === 'finding_detail')

  const railItem = (item: NavItem, mobile = false) => {
    const Icon = item.icon
    const active = isActive(item.view)
    return (
      <button
        key={item.view}
        onClick={() => {
          setView(item.view)
          if (mobile) setMobileOpen(false)
        }}
        title={item.description}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
          active
            ? 'bg-sidebar-accent text-sidebar-primary'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
          mobile && 'px-3 py-2.5 text-sm'
        )}
      >
        {/* Active ink bar — draws in like a bookmark ribbon */}
        {active && (
          <span
            className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-full bg-sidebar-primary"
            style={{ animation: 'view-in 0.4s var(--ease-paper) both' }}
            aria-hidden
          />
        )}
        <Icon className={cn('h-4 w-4 shrink-0 transition-transform duration-200 group-hover:-translate-x-px', active ? 'text-sidebar-primary' : 'opacity-70')} />
        <span className="truncate">{item.label}</span>
        {item.view === 'review_queue' && pending != null && pending > 0 && (
          <span
            className={cn(
              'num ml-auto rounded-sm px-1.5 py-0.5 text-[10px] font-semibold leading-none anim-breathe',
              active || mobile
                ? 'bg-primary/15 text-sidebar-primary'
                : 'bg-sidebar-accent text-sidebar-primary/90'
            )}
            aria-label={`${pending} findings pending review`}
          >
            {pending}
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex flex-1">
        {/* ── Workbench rail (binder spine) ─────────────────────────── */}
        <aside className="sticky top-0 hidden h-screen w-52 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
        {/* Rail logo — the ledger spine inks itself in on first paint */}
          <div className="flex h-14 items-center border-b border-sidebar-border px-3">
            <button onClick={() => setView('dashboard')} className="cursor-pointer" aria-label="Go to case overview">
              <Logo onRail draw />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-1" aria-label="Primary">
            <div className="micro px-2.5 pb-1.5 text-sidebar-foreground/40">Workflow</div>
            {WORKFLOW.map(i => railItem(i))}
            <div className="micro px-2.5 pt-5 pb-1.5 text-sidebar-foreground/40">General</div>
            {GENERAL.map(i => railItem(i))}
          </nav>

          {/* Rail footer: identity + utilities */}
          <div className="border-t border-sidebar-border p-2 space-y-1">
            <div className="px-2.5 py-1.5 flex items-center gap-2 min-w-0">
              <UserCircle2 className="h-4 w-4 shrink-0 text-sidebar-foreground/50" />
              <div className="min-w-0 leading-tight">
                <div className="truncate text-[12px] font-medium text-sidebar-foreground/90">
                  {me ? (me.name ?? me.email) : 'Anonymous'}
                </div>
                <div className="micro truncate text-[9px] text-sidebar-foreground/40">
                  {me ? `${me.role} · signed in` : 'dev preview · not signed in'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 px-1">
              {me ? (
                <RailLinkButton onClick={logout} icon={LogOut} label="Sign out" />
              ) : (
                <a
                  href="/login"
                  className="flex flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-[12px] font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign in
                </a>
              )}
              <div className="ml-auto [&_button]:text-sidebar-foreground/70 [&_button:hover]:bg-sidebar-accent/60">
                <ThemeToggle />
              </div>
            </div>
          </div>
        </aside>

        {/* ── Content column ────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top context bar */}
          <header className="sticky top-0 z-40 w-full border-b border-border bg-background/90 backdrop-blur-md">
            <div className="flex h-14 items-center gap-2 px-3 md:px-6">
              <button
                className="md:hidden inline-flex items-center justify-center rounded-md p-2 hover:bg-muted"
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
                aria-expanded={mobileOpen}
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="flex min-w-0 items-baseline gap-2.5">
                <span className="micro hidden sm:inline">Case file</span>
                <span className="text-[13px] font-semibold text-foreground/60">/</span>
                <h1 className="truncate text-[15px] font-semibold tracking-tight">{activeLabel}</h1>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {process.env.NODE_ENV !== 'production' && <ReSeedButton />}
                <Button
                  size="sm"
                  className="hidden sm:inline-flex bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={openIntake}
                >
                  <ScanSearch className="h-3.5 w-3.5 mr-1.5" />
                  New intake
                </Button>
              </div>
            </div>
          </header>

          {/* Mobile drawer */}
          {mobileOpen && (
            <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
              <div
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                onClick={() => setMobileOpen(false)}
              />
              <div className="absolute left-0 top-0 h-full w-64 bg-sidebar text-sidebar-foreground border-r border-sidebar-border p-3 flex flex-col gap-1">
                <div className="flex items-center justify-between px-1 py-2 mb-2">
                  <Logo onRail />
                  <button
                    className="p-2 rounded-md hover:bg-sidebar-accent"
                    onClick={() => setMobileOpen(false)}
                    aria-label="Close menu"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <nav className="flex-1 space-y-1" aria-label="Primary mobile">
                  <div className="micro px-3 pb-1.5 text-sidebar-foreground/40">Workflow</div>
                  {WORKFLOW.map(i => railItem(i, true))}
                  <div className="micro px-3 pt-4 pb-1.5 text-sidebar-foreground/40">General</div>
                  {GENERAL.map(i => railItem(i, true))}
                </nav>
                <Button
                  className="bg-primary text-primary-foreground"
                  onClick={() => {
                    openIntake()
                    setMobileOpen(false)
                  }}
                >
                  <ScanSearch className="h-3.5 w-3.5 mr-1.5" />
                  New intake
                </Button>
              </div>
            </div>
          )}

          <main key={view} className="flex-1 anim-view">{children}</main>

          {/* Footer */}
          <footer className="mt-auto border-t border-border bg-muted/30">
            <div className="px-4 md:px-6 py-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                <span>Immutable audit log · Role-based access control · Human review on every finding</span>
              </div>
              <div>
                © {new Date().getFullYear()} GAVEL · Forensic reconciliation for dev/IT services
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  )
}

function RailLinkButton({ onClick, icon: Icon, label }: {
  onClick: () => void
  icon: React.ComponentType<{ className?: string }>
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-[12px] font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground transition-colors"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}

async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' })
    toast.success('Signed out')
    setTimeout(() => { window.location.href = '/login' }, 400)
  } catch (e) {
    toast.error('Sign out failed', { description: e instanceof Error ? e.message : 'unknown' })
  }
}

function ReSeedButton() {
  const [busy, setBusy] = useState(false)

  const reseed = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/seed', { method: 'POST' })
      const data = await res.json()
      if (data?.ok) {
        toast.success('Demo data re-seeded', { description: 'Refreshing view…' })
        setTimeout(() => window.location.reload(), 700)
      } else {
        toast.error('Seed failed', { description: data?.error ?? 'unknown' })
      }
    } catch (e) {
      toast.error('Seed failed', { description: e instanceof Error ? e.message : 'unknown' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={reseed}
      disabled={busy}
      className="hidden md:inline-flex text-muted-foreground"
      title="Reset all demo data back to the seeded state"
    >
      <RotateCw className={cn('h-3.5 w-3.5 mr-1.5', busy && 'animate-spin')} />
      {busy ? 'Resetting' : 'Reset demo'}
    </Button>
  )
}
