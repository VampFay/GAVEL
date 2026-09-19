'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/stores/app-store'
import { STAMPS } from './stamp'
import { cn } from '@/lib/utils'

/**
 * VerdictFlash — the moment a ruling lands.
 *
 * When a reviewer approves / dismisses / escalates a finding, a large
 * stamp slams once at screen center over a soft ink splat while the
 * content column takes the strike (the "table thud", applied by the
 * shell). ~1.1s, non-blocking, aria-hidden — the sonner toast is the
 * accessible channel for the decision; this is the physical one.
 *
 * Remounts per trigger via key={flash.key} so identical consecutive
 * rulings re-play. Self-clearing through the store.
 */
export function VerdictFlash() {
  const flash = useAppStore((s) => s.verdictFlash)
  const clear = useAppStore((s) => s.clearVerdictFlash)

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => clear(), 1150)
    return () => clearTimeout(t)
  }, [flash, clear])

  if (!flash) return null
  const stamp = STAMPS[flash.status]
  if (!stamp) return null

  return (
    <div
      key={flash.key}
      className="verdict-overlay pointer-events-none fixed inset-0 z-[70] flex items-center justify-center"
      aria-hidden="true"
    >
      {/* ink splat — a soft wash behind the strike point */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 46%, color-mix(in oklch, var(--primary) 13%, transparent), transparent 62%)',
        }}
      />
      {/* the verdict, at courtroom scale */}
      <div className="relative">
        <span className={cn('stamp stamp-xl stamp-slam stamp-ink', stamp.ink)}>
          {stamp.label}
        </span>
      </div>
    </div>
  )
}
