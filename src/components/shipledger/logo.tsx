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

export function Logo({ className, showWordmark = true, onRail = false, draw = false }: LogoProps) {
  const primaryClass = onRail ? 'text-sidebar-primary' : 'text-primary'
  const accentClass = onRail ? 'text-[oklch(0.78_0.14_75)]' : 'text-accent-foreground'
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="relative h-8 w-8 shrink-0">
        <svg viewBox="0 0 32 32" fill="none" className={cn('h-8 w-8', draw && 'logo-draw anim-logo')}>
          {/* Book / ledger base */}
          <rect x="3" y="6" width="26" height="20" rx="2" fill="currentColor" className={cn(primaryClass, 'opacity-[0.22]')} />
          <rect x="3" y="6" width="26" height="20" rx="2" stroke="currentColor" className={primaryClass} strokeWidth="1.5" />
          {/* Center spine */}
          <line x1="16" y1="6" x2="16" y2="26" stroke="currentColor" className={primaryClass} strokeWidth="1.5" />
          {/* Ledger lines (left page = contracted) */}
          <line x1="6" y1="11" x2="13" y2="11" stroke="currentColor" className={primaryClass} strokeWidth="1.5" opacity="0.65" />
          <line x1="6" y1="15" x2="13" y2="15" stroke="currentColor" className={primaryClass} strokeWidth="1.5" opacity="0.65" />
          <line x1="6" y1="19" x2="11" y2="19" stroke="currentColor" className={primaryClass} strokeWidth="1.5" opacity="0.65" />
          {/* Right page = built (a "ship" arrow) */}
          <path d="M19 19 L26 19 L22.5 14 Z" fill="currentColor" className={accentClass} />
          <line x1="22.5" y1="14" x2="22.5" y2="22" stroke="currentColor" className={accentClass} strokeWidth="1.5" />
        </svg>
      </div>
      {showWordmark && (
        <div className="flex flex-col leading-none">
          <span className={cn('font-semibold tracking-tight text-[15px]', onRail && 'text-sidebar-foreground')}>ShipLedger</span>
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
