// `cn` lives in `src/lib/utils.ts` and is re-exported here for backwards
// compatibility with components that import everything from this module.
export { cn } from './utils'

export function formatINR(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—'
  // Indian numbering: ₹1,23,456
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(Math.round(n))
  if (abs === 0) return '₹0'
  const str = abs.toString()
  let last3 = str.slice(-3)
  let rest = str.slice(0, -3)
  if (rest) {
    rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')
    last3 = ',' + last3
  }
  return `${sign}₹${rest}${last3}`
}

export function formatINRCompact(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)} Cr`
  if (abs >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)} L`
  if (abs >= 1_000) return `₹${(n / 1_000).toFixed(1)}k`
  return formatINR(n)
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  if (isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  if (isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function timeAgo(d: Date | string | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  const diff = Date.now() - date.getTime()
  if (isNaN(diff)) return '—'
  const mins = Math.round(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.round(days / 30)
  return `${months}mo ago`
}

export function confidenceColor(c: 'HIGH' | 'MEDIUM' | 'LOW' | string | null | undefined): {
  bg: string
  text: string
  border: string
} {
  switch (c) {
    case 'HIGH':
      return { bg: 'bg-emerald-100 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-200 dark:border-emerald-900' }
    case 'MEDIUM':
      return { bg: 'bg-amber-100 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-900' }
    case 'LOW':
      return { bg: 'bg-rose-100 dark:bg-rose-950/40', text: 'text-rose-700 dark:text-rose-300', border: 'border-rose-200 dark:border-rose-900' }
    default:
      return { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-border' }
  }
}

export function statusColor(s: string | null | undefined): {
  bg: string
  text: string
  border: string
} {
  switch (s) {
    case 'approved':
      return { bg: 'bg-emerald-100 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-200 dark:border-emerald-900' }
    case 'dismissed':
      return { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-border' }
    case 'escalated':
      return { bg: 'bg-rose-100 dark:bg-rose-950/40', text: 'text-rose-700 dark:text-rose-300', border: 'border-rose-200 dark:border-rose-900' }
    case 'pending_review':
      return { bg: 'bg-amber-100 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-900' }
    default:
      return { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-border' }
  }
}

export function findingTypeLabel(t: string): string {
  switch (t) {
    case 'missed_milestone': return 'Missed milestone'
    case 'unbilled_overage': return 'Unbilled overage'
    case 'scope_expansion': return 'Scope expansion'
    case 'rate_discrepancy': return 'Rate discrepancy'
    case 'unauthorized_work': return 'Unauthorized work'
    default: return t
  }
}

export function assessmentLabel(a: string): string {
  switch (a) {
    case 'billable': return 'Billable'
    case 'already_covered': return 'Already covered'
    case 'ambiguous': return 'Ambiguous'
    default: return a
  }
}

export function recommendedActionLabel(a: string): string {
  switch (a) {
    case 'approve': return 'Approve & bill'
    case 'dismiss': return 'Dismiss'
    case 'request_review': return 'Request review'
    case 'draft_change_order': return 'Draft change order'
    default: return a
  }
}

export function evidenceTypeLabel(t: string): string {
  switch (t) {
    case 'contract_clause': return 'Contract clause'
    case 'delivery_record': return 'Delivery record'
    case 'billing_record': return 'Billing record'
    case 'supporting': return 'Supporting record'
    case 'contradicting': return 'Contradicting record'
    default: return t
  }
}

export function sourceLabel(s: string): string {
  switch (s) {
    case 'sow': return 'SOW'
    case 'jira': return 'Jira'
    case 'github': return 'GitHub'
    case 'gitlab': return 'GitLab'
    case 'invoice': return 'Invoice'
    case 'change_order': return 'Change order'
    default: return s
  }
}

export function sourceColor(s: string): { bg: string; text: string } {
  switch (s) {
    case 'sow': return { bg: 'bg-emerald-100 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-300' }
    case 'jira': return { bg: 'bg-violet-100 dark:bg-violet-950/40', text: 'text-violet-700 dark:text-violet-300' }
    case 'github':
    case 'gitlab':
      return { bg: 'bg-slate-200 dark:bg-slate-800/60', text: 'text-slate-700 dark:text-slate-300' }
    case 'invoice': return { bg: 'bg-amber-100 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-300' }
    case 'change_order': return { bg: 'bg-rose-100 dark:bg-rose-950/40', text: 'text-rose-700 dark:text-rose-300' }
    default: return { bg: 'bg-muted', text: 'text-muted-foreground' }
  }
}
