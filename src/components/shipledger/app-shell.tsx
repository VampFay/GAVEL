'use client'

import { useState } from 'react'
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
  Home,
  Menu,
  X,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'

interface NavItem {
  view: View
  label: string
  icon: React.ComponentType<{ className?: string }>
  description: string
}

const NAV: NavItem[] = [
  { view: 'landing', label: 'Home', icon: Home, description: 'Value proposition' },
  { view: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, description: 'KPIs & recent activity' },
  { view: 'audits', label: 'Audits', icon: FileSearch, description: 'Audit clients & SOWs' },
  { view: 'review_queue', label: 'Review queue', icon: ClipboardCheck, description: 'Approve / dismiss findings' },
  { view: 'monitoring', label: 'Monitoring', icon: Activity, description: 'Live drift & alerts' },
  { view: 'pricing', label: 'Pricing', icon: Sparkles, description: 'Tiers & payment wall' },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const { view, setView, openIntake } = useAppStore()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur-md">
        <div className="flex h-14 items-center gap-2 px-3 md:px-6">
          <button
            className="md:hidden inline-flex items-center justify-center rounded-md p-2 hover:bg-muted"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            aria-expanded={mobileOpen}
          >
            <Menu className="h-5 w-5" />
          </button>
          <button onClick={() => setView('landing')} className="cursor-pointer" aria-label="Go to home">
            <Logo />
          </button>
          <nav className="ml-6 hidden md:flex items-center gap-1" aria-label="Primary">
            {NAV.map(item => {
              const Icon = item.icon
              const active = view === item.view || (item.view === 'audits' && (view === 'audit_detail' || view === 'finding_detail'))
              return (
                <button
                  key={item.view}
                  onClick={() => setView(item.view)}
                  title={item.description}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              )
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {process.env.NODE_ENV !== 'production' && <ReSeedButton />}
            <ThemeToggle />
            <Button
              size="sm"
              className="hidden sm:inline-flex bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={openIntake}
            >
              <FileSearch className="h-3.5 w-3.5 mr-1.5" />
              Run new audit
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
          <div className="absolute left-0 top-0 h-full w-64 bg-background border-r border-border p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between mb-4">
              <Logo />
              <button
                className="p-2 rounded-md hover:bg-muted"
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {NAV.map(item => {
              const Icon = item.icon
              const active = view === item.view
              return (
                <button
                  key={item.view}
                  onClick={() => {
                    setView(item.view)
                    setMobileOpen(false)
                  }}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-left transition-colors',
                    active ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              )
            })}
            <Button
              className="mt-4 bg-primary text-primary-foreground"
              onClick={() => {
                openIntake()
                setMobileOpen(false)
              }}
            >
              <FileSearch className="h-3.5 w-3.5 mr-1.5" />
              Run new audit
            </Button>
          </div>
        </div>
      )}

      {/* Main */}
      <main className="flex-1">{children}</main>

      {/* Footer */}
      <footer className="mt-auto border-t border-border bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Immutable audit log · Role-based access control · Human review on every finding</span>
          </div>
          <div className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} ShipLedger — working name. Placeholder, not locked.
          </div>
        </div>
      </footer>
    </div>
  )
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
