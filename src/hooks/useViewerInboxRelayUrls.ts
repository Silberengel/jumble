import { userReadInboxUrls } from '@/lib/favorites-feed-relays'
import { useNostrOptional } from '@/providers/nostr-context'
import { useMemo } from 'react'

/** Viewer read inbox: kind 10432 cache + kind 10243 HTTP + kind 10002 WS (for embed / thread fan-out). */
export function useViewerInboxRelayUrls(): {
  inboxRelayUrls: string[]
} {
  const nostr = useNostrOptional()
  const inboxRelayUrls = useMemo(
    () => userReadInboxUrls(nostr?.relayList, nostr?.cacheRelayListEvent).slice(0, 14),
    [nostr?.relayList, nostr?.cacheRelayListEvent]
  )
  return { inboxRelayUrls }
}
