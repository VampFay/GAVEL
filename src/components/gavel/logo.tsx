'use client'

import { cn } from '@/lib/utils'

interface LogoProps {
  className?: string
  showWordmark?: boolean
  /** Rail variant: brighter inks for the dark sidebar. */
  onRail?: boolean
  /** Play the ink-draw animation once on mount. */
  draw?: boolean
}

/**
 * GAVEL brand mark — a straight-on gavel: mallet head, handle, and the
 * sound block it strikes. Structure (head/handle/block) is drawn in the
 * primary ink; the two impact ticks are the accent — the strike is where
 * the verdict happens.
 *
 * Geometry is stroke-based (rect/line) so the `logo-draw` entrance
 * animation (stroke-dashoffset) applies unchanged. Works at 16px favicon
 * scale: three stacked masses (head / handle / block).
 *
 * `logo-strike` (always on): hovering the mark lifts the mallet group and
 * flares the impact ticks — the strike is live under the cursor. Pure
 * CSS (see globals.css); no JS.
 */
export function Logo({ className, showWordmark = true, onRail = false, draw = false }: LogoProps) {
  const primaryClass = onRail ? 'text-sidebar-primary' : 'text-primary'
  const accentClass = onRail ? 'text-[oklch(0.78_0.14_75)]' : 'text-accent-foreground'
  return (
    <div className={cn('logo-strike flex items-center gap-2', className)}>
      <div className="relative h-8 w-8 shrink-0">
        <svg viewBox="0 0 32 32" fill="none" className={cn('h-8 w-8', draw && 'logo-draw anim-logo')}>
          {/* Mallet: head + handle — lifts as one on hover */}
          <g className="logo-mallet">
            <rect x="8" y="4" width="16" height="7" rx="2" fill="currentColor" className={cn(primaryClass, 'opacity-[0.22]')} />
            <rect x="8" y="4" width="16" height="7" rx="2" stroke="currentColor" className={primaryClass} strokeWidth="1.5" />
            <line x1="16" y1="11" x2="16" y2="21.5" stroke="currentColor" className={primaryClass} strokeWidth="2.25" strokeLinecap="round" />
          </g>
          {/* Sound block */}
          <rect x="6" y="24.5" width="20" height="4" rx="1" fill="currentColor" className={cn(primaryClass, 'opacity-[0.22]')} />
          <rect x="6" y="24.5" width="20" height="4" rx="1" stroke="currentColor" className={primaryClass} strokeWidth="1.5" />
          {/* Impact ticks (the strike) — flare on hover */}
          <line x1="11" y1="22" x2="8.5" y2="19.5" stroke="currentColor" className={cn(accentClass, 'logo-tick')} strokeWidth="1.75" strokeLinecap="round" />
          <line x1="21" y1="22" x2="23.5" y2="19.5" stroke="currentColor" className={cn(accentClass, 'logo-tick')} strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      </div>
      {showWordmark && (
        <div className="flex flex-col leading-none">
          <span className={cn('font-semibold tracking-tight text-[15px]', onRail && 'text-sidebar-foreground')}>GAVEL</span>
          <span className={cn(
            'text-[10px] uppercase tracking-[0.12em]',
            onRail ? 'text-sidebar-foreground/50' : 'text-muted-foreground'
          )}>
            Forensic Reconciliation
          </span>
        </div>
      )}
    </div>
  )
}
