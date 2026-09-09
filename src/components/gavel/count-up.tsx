'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * CountUp — money that counts itself up, like an adding machine running
 * a tape. Uses requestAnimationFrame with an ease-out; renders the final
 * value immediately for reduced-motion users and after the first paint
 * for SEO/copy (the final formatted value is what ends up in the DOM).
 *
 * No dependencies, no libraries — 30 lines of craft.
 */
export function CountUp({
  value,
  format,
  duration = 850,
  className,
}: {
  value: number | null | undefined
  format: (n: number) => string
  duration?: number
  className?: string
}) {
  const [display, setDisplay] = useState(() => (value == null ? null : 0))
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (value == null) {
      setDisplay(null)
      return
    }
    // Reduced motion: no tape, just the figure.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value)
      return
    }
    const start = performance.now()
    const from = 0
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      // easeOutCubic — fast tape, gentle landing
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(from + (value - from) * eased)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [value, duration])

  if (display == null) return <span className={className}>—</span>
  return <span className={className}>{format(Math.round(display))}</span>
}
