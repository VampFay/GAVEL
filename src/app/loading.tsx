import { Skeleton } from '@/components/ui/skeleton'

/**
 * Global loading fallback. Shown by Next.js while a route segment is
 * loading. Replaces the perpetual-Skeleton-on-error issue by giving
 * a clear visual signal that data is being fetched.
 */
export default function Loading() {
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-3" aria-busy="true" aria-live="polite">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-4 w-1/3" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  )
}
