'use client'

import { cn } from '@/lib/utils'

/**
 * Stamp — the human verdict on a case file.
 *
 * When a reviewer approves / dismisses / escalates a finding, the status
 * isn't just a colored badge: it's a rubber stamp coming down on paper.
 * The slam animation plays whenever the element mounts (i.e. right after
 * the action reloads the data), so the reviewer sees their decision
 * physically land in the file.
 *
 * `slam` controls whether the entrance animation plays (queue rows: only
 * stamp once; detail masthead: always animate on open).
 */
const STAMPS: Record<string, { label: string; ink: string }> = {
  approved: {
    label: 'Approved',
    ink: 'text-emerald-700 dark:text-emerald-300',
  },
  dismissed: {
    label: 'Dismissed',
    ink: 'text-stone-600 dark:text-stone-300',
  },
  escalated: {
    label: 'Escalated',
    ink: 'text-rose-700 dark:text-rose-300',
  },
}

export function Stamp({
  status,
  slam = true,
  className,
}: {
  status: string
  slam?: boolean
  className?: string
}) {
  const stamp = STAMPS[status]
  if (!stamp) return null
  return (
    <span
      className={cn('stamp', stamp.ink, slam && 'stamp-slam', className)}
      role="img"
      aria-label={`Finding ${stamp.label.toLowerCase()}`}
    >
      {stamp.label}
    </span>
  )
}
