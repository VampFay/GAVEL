'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertCircle, RotateCw, ArrowLeft } from 'lucide-react'

/**
 * Global error boundary — catches render errors thrown by any view
 * routed through `src/app/page.tsx`. Previously a thrown error would
 * crash the whole app with no recovery; this gives the user a "Retry"
 * button that reloads the page.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[global-error-boundary]', error)
  }, [error])

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="h-14 w-14 mx-auto rounded-full bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 flex items-center justify-center">
          <AlertCircle className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Something went wrong</h2>
          <p className="text-sm text-muted-foreground mt-1">
            An unexpected error occurred while rendering this view. The team has been notified — please try again, or reload the page.
          </p>
        </div>
        {error.digest && (
          <p className="text-[10px] text-muted-foreground font-mono">
            ref: {error.digest}
          </p>
        )}
        <div className="flex gap-2 justify-center">
          <Button variant="outline" onClick={() => window.history.back()}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
            Back
          </Button>
          <Button onClick={reset}>
            <RotateCw className="h-3.5 w-3.5 mr-1.5" />
            Try again
          </Button>
        </div>
      </div>
    </div>
  )
}
