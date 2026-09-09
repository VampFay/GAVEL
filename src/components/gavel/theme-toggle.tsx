'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

/**
 * ThemeToggle — with the ink drop.
 *
 * Where the View Transitions API is available, switching themes doesn't
 * hard-cut: the new theme spreads out from the toggle button in an
 * expanding circle — a drop of ink bleeding across the page. The old
 * snapshot sits still underneath until the new ink covers it.
 *
 * Progressive enhancement: reduced-motion users and browsers without
 * the API get an instant swap (the CSS also pins the snapshots so no
 * default cross-fade fights the circle).
 *
 * The class flip is done synchronously inside the transition callback
 * (next-themes applies it via React effect, which may land after the
 * snapshot is captured); `setTheme` still runs afterwards to persist
 * and keep the provider state honest — both writes agree, so no flip.
 */
type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => { ready: Promise<void> }
}

export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className="rounded-full" aria-label="Toggle theme">
        <Sun className="h-4 w-4" />
      </Button>
    )
  }

  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    const next = resolvedTheme === 'dark' ? 'light' : 'dark'
    const doc = document as DocumentWithViewTransition
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

    if (typeof doc.startViewTransition !== 'function' || reduce) {
      setTheme(next)
      return
    }

    // Center of the strike — the toggle itself.
    const rect = e.currentTarget.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2

    const transition = doc.startViewTransition(() => {
      document.documentElement.classList.toggle('dark', next === 'dark')
      document.documentElement.style.colorScheme = next
    })

    transition.ready
      .then(() => {
        // Radius to the farthest corner: the ink must cover the page.
        const r = Math.hypot(
          Math.max(x, window.innerWidth - x),
          Math.max(y, window.innerHeight - y),
        )
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
          {
            duration: 520,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            pseudoElement: '::view-transition-new(root)',
          },
        )
      })
      .catch(() => {
        /* transition skipped (tab hidden, interrupted) — theme still swapped */
      })

    // Persist + sync the provider (idempotent with the manual flip above).
    setTheme(next)
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="rounded-full"
      aria-label={resolvedTheme === 'dark' ? 'Switch to light' : 'Switch to dark'}
      onClick={toggle}
    >
      {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  )
}
