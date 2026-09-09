'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * useInView — one-shot IntersectionObserver reveal.
 *
 * Fires once when the element enters the viewport (with a small bottom
 * margin so content reveals just before it's comfortably readable, not
 * at the exact viewport edge), then disconnects. No re-arming: reveal is
 * "paper being laid down", not a looping effect.
 *
 * Fails open: if IntersectionObserver is unavailable (very old browsers,
 * exotic test environments), the element is treated as in-view so
 * content is never stranded invisible. SSR renders false (hidden by
 * the .reveal base state); hydration + observer settle it immediately
 * for above-the-fold content.
 */
export function useInView<T extends HTMLElement = HTMLElement>(
  options?: { rootMargin?: string; threshold?: number },
): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true)
          io.disconnect()
        }
      },
      {
        rootMargin: options?.rootMargin ?? '0px 0px -8% 0px',
        threshold: options?.threshold ?? 0.08,
      },
    )
    io.observe(el)
    return () => io.disconnect()
    // Options are read once on mount by design — the reveal geometry
    // does not change over the element's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return [ref, inView]
}
