import { toRelay } from '@/lib/link'
import { useSecondaryPage } from '@/PageManager'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { X } from 'lucide-react'
import { useState } from 'react'
import RelayIcon from '../RelayIcon'
import { Button } from '../ui/button'
import { Skeleton } from '../ui/skeleton'
import logger from '@/lib/logger'

export default function BlockedRelayItem({ relay }: { relay: string }) {
  const { push } = useSecondaryPage()
  const { deleteBlockedRelays } = useFavoriteRelays()
  const [isLoading, setIsLoading] = useState(false)

  const handleUnblock = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isLoading) return

    setIsLoading(true)
    try {
      await deleteBlockedRelays([relay])
    } catch (error) {
      logger.error('Failed to unblock relay', { error, relay })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div
      className="relative group clickable flex min-w-0 items-start gap-2 rounded-lg border p-2 select-none sm:items-center"
      onClick={() => push(toRelay(relay))}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <RelayIcon url={relay} skipRelayInfoFetch className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1 break-all text-sm font-semibold leading-snug">{relay}</div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleUnblock}
        disabled={isLoading}
        className="h-8 w-8 shrink-0 p-0"
      >
        {isLoading ? (
          <Skeleton className="size-4 shrink-0 rounded-sm" aria-hidden />
        ) : (
          <X className="h-4 w-4" />
        )}
      </Button>
    </div>
  )
}

