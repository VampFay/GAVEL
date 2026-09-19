'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Logo } from '@/components/gavel/logo'
import { toast } from 'sonner'

/**
 * Minimal login page.
 *
 * Why so plain? Because the real GAVEL UI lives behind a single-page
 * "AppShell" router (see src/components/gavel/app-shell.tsx). The
 * login page is intentionally outside that shell so it loads fast even
 * when the rest of the bundle is still downloading, and so it works
 * without the Zustand store / theme provider. The shell reads the auth
 * cookie via /api/auth/me on mount and routes to /login if 401.
 *
 * Invite / password-reset links land on /login?invite=<token> — the form
 * switches to "set your password" mode (POST /api/auth/invite), then
 * returns to the standard sign-in flow. No session is issued implicitly:
 * the invitee signs in with the password they just chose.
 *
 * Demo credentials (after running `bun run seed:dev` — the hint below
 * renders in development builds only; production never advertises
 * seeded accounts):
 *   admin@gavel.demo    / gavel-admin-demo
 *   reviewer@gavel.demo / gavel-reviewer-demo
 *   viewer@gavel.demo   / gavel-viewer-demo
 */

function LoginCard() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const inviteToken = searchParams.get('invite')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)

  /* Invite mode: the token lives only in the URL — keep it there so a
     refresh doesn't lose it mid-flow. */
  const isInviteMode = !!inviteToken

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error('Login failed', {
          description: body?.error ?? 'unknown error',
        })
        return
      }
      // Logged in — land directly in the workflow (case overview), not
      // the marketing view. The shell store survives the client-side
      // navigation, so this sets the entry view for the session.
      const { useAppStore } = await import('@/stores/app-store')
      useAppStore.getState().setView('dashboard')
      router.push('/')
      router.refresh()
    } catch (err) {
      toast.error('Login failed', {
        description: err instanceof Error ? err.message : 'network error',
      })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleInviteAccept(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteToken) return
    if (password !== confirm) {
      toast.error('Passwords do not match')
      return
    }
    if (password.length < 10) {
      toast.error('Password too short', { description: 'Use at least 10 characters.' })
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: inviteToken, password }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error('Could not set password', {
          description: body?.error ?? 'unknown error',
        })
        return
      }
      toast.success('Password set', { description: 'You can sign in now.' })
      // Back to the plain login form with the URL cleaned up.
      router.replace('/login')
    } catch (err) {
      toast.error('Could not set password', {
        description: err instanceof Error ? err.message : 'network error',
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (isInviteMode) {
    return (
      <form onSubmit={handleInviteAccept}
        className="relative anim-panel-in w-full max-w-sm space-y-6 rounded-md border bg-card p-8 shadow-sm"
      >
        <h1 className="sr-only">GAVEL — set your password</h1>
        <div className="flex justify-center">
          <Logo draw />
        </div>

        <div className="text-center space-y-1">
          <h2 className="text-sm font-medium">Set your password</h2>
          <p className="text-xs text-muted-foreground">
            You were invited to GAVEL. Choose a password (10+ characters) to activate your account.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="new-password" className="micro">New password</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={password}
            onChange={e => setPassword(e.target.value)}
            disabled={submitting}
            className="num text-[13px]"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm-password" className="micro">Confirm password</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            disabled={submitting}
            className="num text-[13px]"
          />
        </div>

        <Button type="submit" className="w-full bg-primary text-primary-foreground hover:bg-primary/90" disabled={submitting}>
          {submitting ? 'Saving…' : 'Activate account'}
        </Button>

        <p className="num text-center text-[10px] text-muted-foreground/70">
          link expires 72h after it was issued
        </p>
      </form>
    )
  }

  return (
    <form onSubmit={handleLogin}
      className="relative anim-panel-in w-full max-w-sm space-y-6 rounded-md border bg-card p-8 shadow-sm"
    >
      <h1 className="sr-only">GAVEL — sign in</h1>
      <div className="flex justify-center">
        <Logo draw />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email" className="micro">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          disabled={submitting}
          className="num text-[13px]"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password" className="micro">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
          disabled={submitting}
          className="num text-[13px]"
        />
      </div>

      <Button type="submit" className="w-full bg-primary text-primary-foreground hover:bg-primary/90" disabled={submitting}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>

      {process.env.NODE_ENV === 'development' && (
        <p className="num text-center text-[10px] text-muted-foreground/70">
          demo: admin@gavel.demo / gavel-admin-demo
        </p>
      )}
    </form>
  )
}

export default function LoginPage() {
  /* useSearchParams needs a Suspense boundary for static rendering. */
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-muted/30 px-4">
      {/* ledger grid backdrop — the case-file paper */}
      <div className="ledger-grid absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" aria-hidden="true" />
      <Suspense fallback={<div className="w-full max-w-sm" aria-hidden />}>
        <LoginCard />
      </Suspense>
    </div>
  )
}
