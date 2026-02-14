'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    useEffect(() => {
        // Log the error to an error reporting service
        console.error('Page Error:', error)
    }, [error])

    return (
        <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-zinc-950 text-white">
            <h2 className="text-2xl font-bold text-red-500 mb-4">Something went wrong!</h2>
            <div className="bg-zinc-900 p-4 rounded-md border border-red-500/20 mb-6 max-w-lg overflow-auto">
                <p className="font-mono text-sm text-red-200">{error.message}</p>
                {error.digest && <p className="text-xs text-zinc-500 mt-2">Digest: {error.digest}</p>}
            </div>
            <Button
                variant="outline"
                onClick={
                    // Attempt to recover by trying to re-render the segment
                    () => reset()
                }
                className="text-black bg-white hover:bg-zinc-200"
            >
                Try again
            </Button>
        </div>
    )
}
