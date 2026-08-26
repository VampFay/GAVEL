'use client'

import { cn } from '@/lib/utils'

interface LogoProps {
  className?: string
  showWordmark?: boolean
}

export function Logo({ className, showWordmark = true }: LogoProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="relative h-8 w-8 shrink-0">
        <svg viewBox="0 0 32 32" fill="none" className="h-8 w-8">
          {/* Book / ledger base */}
          <rect x="3" y="6" width="26" height="20" rx="2" fill="currentColor" className="text-primary" opacity="0.18" />
          <rect x="3" y="6" width="26" height="20" rx="2" stroke="currentColor" className="text-primary" strokeWidth="1.5" />
          {/* Center spine */}
          <line x1="16" y1="6" x2="16" y2="26" stroke="currentColor" className="text-primary" strokeWidth="1.5" />
          {/* Ledger lines (left page = contracted) */}
          <line x1="6" y1="11" x2="13" y2="11" stroke="currentColor" className="text-primary" strokeWidth="1.5" opacity="0.65" />
          <line x1="6" y1="15" x2="13" y2="15" stroke="currentColor" className="text-primary" strokeWidth="1.5" opacity="0.65" />
          <line x1="6" y1="19" x2="11" y2="19" stroke="currentColor" className="text-primary" strokeWidth="1.5" opacity="0.65" />
          {/* Right page = built (a "ship" arrow) */}
          <path d="M19 19 L26 19 L22.5 14 Z" fill="currentColor" className="text-accent-foreground" />
          <line x1="22.5" y1="14" x2="22.5" y2="22" stroke="currentColor" className="text-accent-foreground" strokeWidth="1.5" />
        </svg>
      </div>
      {showWordmark && (
        <div className="flex flex-col leading-none">
          <span className="font-semibold tracking-tight text-[15px]">ShipLedger</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-[0.12em]">Forensic Reconciliation</span>
        </div>
      )}
    </div>
  )
}
