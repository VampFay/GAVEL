'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

/**
 * Minimal login page.
 *
 * Why so plain? Because the real ShipLedger UI lives behind a single-page
 * "AppShell" router (see src/components/shipledger/app-shell.tsx). The
 * login page is intentionally outside that shell so it loads fast even
 * when the rest of the bundle is still downloading, and so it works
 * without the Zustand store / theme provider. The shell reads the auth
 * cookie via /api/auth/me on mount and routes to /login if 401.
 *
 * Demo credentials (after running `bun run seed:dev`):
 *   admin@shipledger.demo    /  shipledger-admin-demo
 *   reviewer@shipledger.demo /  shipledger-reviewer-demo
 *   viewer@shipledger.demo   /  shipledger-viewer-demo
 */
export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
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
      // Logged in — send the user to the dashboard.
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-6 rounded-xl border bg-card p-8 shadow-sm"
      >
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">ShipLedger</h1>
          <p className="text-sm text-muted-foreground">
            Forensic delivery-to-billing reconciliation
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            disabled={submitting}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
            disabled={submitting}
          />
        </div>

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          Demo: admin@shipledger.demo / shipledger-admin-demo
        </p>
      </form>
    </div>
  )
}
