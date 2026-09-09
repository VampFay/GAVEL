'use client'

import type { CSSProperties, ReactNode } from 'react'
import { useInView } from '@/hooks/use-in-view'
import { cn } from '@/lib/utils'

/**
 * Reveal — content laid on the desk as you read.
 *
 * Wraps a block; when it scrolls into view it rises and settles
 * (paper easing, one shot). `delay` staggers sibling reveals into a
 * hand-paced cascade — use small values (0–300ms).
 *
 * Reduced-motion users get it instantly (global CSS guard collapses
 * the transition). No-JS fallback lives in layout.tsx <noscript>.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  style,
}: {
  children: ReactNode
  className?: string
  delay?: number
  style?: CSSProperties
}) {
  const [ref, inView] = useInView<HTMLDivElement>()
  return (
    <div
      ref={ref}
      style={{ ...style, transitionDelay: inView ? `${delay}ms` : '0ms' }}
      className={cn('reveal', inView && 'reveal-in', className)}
    >
      {children}
    </div>
  )
}

/**
 * RevealLine — a rule that draws itself left-to-right on entry.
 * The element itself is the line: give it height/bg via className
 * (default: a hairline in the border color).
 */
export function RevealLine({ className, delay = 0 }: { className?: string; delay?: number }) {
  const [ref, inView] = useInView<HTMLDivElement>({ threshold: 0.2 })
  return (
    <div
      ref={ref}
      aria-hidden
      style={{ transitionDelay: `${delay}ms` }}
      className={cn('h-px w-full bg-border rule-ink', inView && 'rule-ink-in', className)}
    />
  )
}
