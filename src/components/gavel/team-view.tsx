'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAppStore } from '@/stores/app-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  UserPlus, KeyRound, ShieldCheck, Loader2, Copy, Ban, RotateCw,
  ShieldAlert, CheckCircle2, Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { apiGet, apiPost, apiPatch } from '@/lib/fetch'
import { cn } from '@/lib/utils'

/* /api/auth/me shape (fetched in-shell too — this view needs it for gating). */
interface Me {
  user: { email: string; name: string | null; role: string } | null
}

/**
 * Team administration (production blocker #3 UI).
 *
 * Admin-only view over /api/admin/users:
 *   - list the tenant's users (cross-tenant users are invisible by design)
 *   - invite a user (email + role) → one-time invite link to deliver
 *     over the admin's own channel (GAVEL sends no email)
 *   - change role / disable / re-enable (guards: no self-lockout, never
 *     demote the last active admin — enforced server-side too)
 *   - force password reset → one-time reset link
 *
 * Links are shown ONCE in a dialog with a copy button — they are not
 * stored client-side anywhere.
 */

interface TeamUser {
  id: string
  email: string
  name: string | null
  role: string
  status: string
  hasPassword: boolean
  createdAt: string
}

interface IssuedLink {
  token: string
  path: string
  url: string
  expiresInSeconds: number
  note?: string
}

const ROLE_RANK: Record<string, number> = { viewer: 0, reviewer: 1, admin: 2 }

export function TeamView() {
  const [users, setUsers] = useState<TeamUser[]>([])
  const [loading, setLoading] = useState(true)
  const [me, setMe] = useState<Me['user']>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [linkResult, setLinkResult] = useState<{ title: string; link: IssuedLink } | null>(null)

  useEffect(() => {
    let alive = true
    apiGet<Me>('/api/auth/me').then(({ data }) => {
      if (alive && data?.user) setMe(data.user)
    })
    return () => { alive = false }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data, error } = await apiGet<{ users: TeamUser[] }>('/api/admin/users')
    if (error) {
      if (error.status !== 403 && error.status !== 401) {
        toast.error('Could not load team', { description: error.message })
      }
      setUsers([])
    } else {
      setUsers(data?.users ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const isAdmin = me?.role === 'admin'

  /* ── Invite dialog state ─────────────────────────────────────────── */
  const [invEmail, setInvEmail] = useState('')
  const [invName, setInvName] = useState('')
  const [invRole, setInvRole] = useState<'viewer' | 'reviewer' | 'admin'>('reviewer')
  const [invBusy, setInvBusy] = useState(false)

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault()
    setInvBusy(true)
    const { data, error } = await apiPost<{ user: TeamUser; invite: IssuedLink }>(
      '/api/admin/users',
      { email: invEmail, name: invName || undefined, role: invRole }
    )
    setInvBusy(false)
    if (error || !data) {
      toast.error('Invite failed', { description: error?.message ?? 'unknown error' })
      return
    }
    setInviteOpen(false)
    setInvEmail('')
    setInvName('')
    setLinkResult({ title: `Invite link for ${data.user.email}`, link: data.invite })
    void refresh()
  }

  async function changeRole(u: TeamUser, role: string) {
    const { error } = await apiPatch(`/api/admin/users/${u.id}`, { role })
    if (error) {
      toast.error('Could not change role', { description: error.message })
      return
    }
    toast.success(`${u.email} is now ${role}`)
    void refresh()
  }

  async function toggleStatus(u: TeamUser) {
    const next = u.status === 'active' ? 'disabled' : 'active'
    const { error } = await apiPatch(`/api/admin/users/${u.id}`, { status: next })
    if (error) {
      toast.error('Could not update account', { description: error.message })
      return
    }
    toast.success(next === 'disabled' ? `${u.email} disabled — sessions revoked` : `${u.email} re-enabled`)
    void refresh()
  }

  async function resetPassword(u: TeamUser) {
    const { data, error } = await apiPost<{ reset: IssuedLink }>(`/api/admin/users/${u.id}/reset-password`)
    if (error || !data) {
      toast.error('Could not issue reset', { description: error?.message ?? 'unknown error' })
      return
    }
    setLinkResult({ title: `Password-reset link for ${u.email}`, link: data.reset })
  }

  function copyLink(url: string) {
    const absolute = url.startsWith('http') ? url : `${window.location.origin}${url}`
    void navigator.clipboard.writeText(absolute).then(
      () => toast.success('Link copied'),
      () => toast.error('Could not copy — select it manually')
    )
  }

  /* ── Non-admins never see the management surface ─────────────────── */
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-muted-foreground/50" />
        <h2 className="mt-4 font-medium">Administrators only</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Team management requires the admin role. Your account has role
          “{me?.role ?? 'unknown'}”.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-medium">
            <Users className="h-4 w-4 text-primary" /> Team
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Users who can access this tenant’s data. Cross-tenant accounts are invisible here by design.
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)} className="bg-primary text-primary-foreground hover:bg-primary/90">
          <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Invite user
        </Button>
      </div>

      <Separator className="my-5" />

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : users.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">No users found.</p>
      ) : (
        <ScrollArea className="max-h-[65vh]">
          <div className="space-y-2">
            {users.map(u => (
              <div
                key={u.id}
                className={cn(
                  'flex flex-wrap items-center gap-3 rounded-md border bg-card p-3.5',
                  u.status === 'disabled' && 'opacity-60'
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{u.name || u.email}</span>
                    {u.email !== u.name && (
                      <span className="num truncate text-xs text-muted-foreground">{u.email}</span>
                    )}
                    {u.status === 'disabled' && <Badge variant="outline" className="text-[10px]">disabled</Badge>}
                    {!u.hasPassword && u.status === 'active' && (
                      <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-400">
                        invite pending
                      </Badge>
                    )}
                    {me?.email === u.email && <Badge variant="outline" className="text-[10px]">you</Badge>}
                  </div>
                  <p className="num mt-0.5 text-[10px] text-muted-foreground/70">
                    joined {new Date(u.createdAt).toLocaleDateString()}
                  </p>
                </div>

                {/* Role selector */}
                <select
                  value={u.role}
                  onChange={e => void changeRole(u, e.target.value)}
                  disabled={me?.email === u.email}
                  aria-label={`Role for ${u.email}`}
                  className="num rounded border bg-background px-2 py-1 text-xs disabled:opacity-50"
                >
                  {(['viewer', 'reviewer', 'admin'] as const).map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>

                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => void resetPassword(u)}
                    title="Force password reset — issues a one-time link"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => void toggleStatus(u)}
                    disabled={me?.email === u.email}
                    title={u.status === 'active' ? 'Disable account' : 'Re-enable account'}
                  >
                    {u.status === 'active' ? <Ban className="h-3.5 w-3.5" /> : <RotateCw className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      {/* ── Invite dialog ─────────────────────────────────────────── */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite a user</DialogTitle>
            <DialogDescription>
              They’ll set their own password via a one-time link you deliver (GAVEL sends no email).
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={sendInvite} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="inv-email" className="micro">Email</Label>
              <Input id="inv-email" type="email" required value={invEmail}
                onChange={e => setInvEmail(e.target.value)} disabled={invBusy} className="num text-[13px]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-name" className="micro">Name (optional)</Label>
              <Input id="inv-name" value={invName}
                onChange={e => setInvName(e.target.value)} disabled={invBusy} className="num text-[13px]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-role" className="micro">Role</Label>
              <select
                id="inv-role"
                value={invRole}
                onChange={e => setInvRole(e.target.value as typeof invRole)}
                disabled={invBusy}
                className="num w-full rounded border bg-background px-2.5 py-2 text-[13px]"
              >
                <option value="viewer">viewer — read-only</option>
                <option value="reviewer">reviewer — triage findings</option>
                <option value="admin">admin — full control</option>
              </select>
            </div>
            <Button type="submit" className="w-full bg-primary text-primary-foreground hover:bg-primary/90" disabled={invBusy}>
              {invBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />}
              Create invite link
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── One-time link dialog ──────────────────────────────────── */}
      <Dialog open={!!linkResult} onOpenChange={open => { if (!open) setLinkResult(null) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              {linkResult?.title}
            </DialogTitle>
            <DialogDescription>
              {linkResult?.link.note ?? 'Share over your own secure channel. Shown once — copy it now.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="num flex-1 overflow-x-auto whitespace-nowrap rounded border bg-muted/50 px-3 py-2 text-xs">
                {linkResult?.link.url || linkResult?.link.path}
              </code>
              <Button variant="outline" size="sm" onClick={() => linkResult && copyLink(linkResult.link.url || linkResult.link.path)}>
                <Copy className="mr-1 h-3.5 w-3.5" /> Copy
              </Button>
            </div>
            <p className="num text-[10px] text-muted-foreground/70">
              expires in {Math.round((linkResult?.link.expiresInSeconds ?? 0) / 3600)} hours
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
