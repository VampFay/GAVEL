import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Compass } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="h-14 w-14 mx-auto rounded-full bg-muted text-muted-foreground flex items-center justify-center">
          <Compass className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Page not found</h2>
          <p className="text-sm text-muted-foreground mt-1">
            The page you were looking for doesn&apos;t exist or may have moved.
          </p>
        </div>
        <Button asChild>
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </div>
  )
}
