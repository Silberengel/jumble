import { userReadInboxUrls, userWriteOutboxUrls } from '@/lib/favorites-feed-relays'
import { useNostrOptional } from '@/providers/nostr-context'
import { useMemo } from 'react'

/** Viewer read inbox: kind 10432 cache + kind 10243 HTTP + kind 10002 WS. */
export function useUserReadInboxUrls(): string[] {
  const nostr = useNostrOptional()
  return useMemo(
    () => userReadInboxUrls(nostr?.relayList, nostr?.cacheRelayListEvent),
    [nostr?.relayList, nostr?.cacheRelayListEvent]
  )
}

/** Viewer write outbox: kind 10432 cache + kind 10243 HTTP + kind 10002 WS. */
export function useUserWriteOutboxUrls(): string[] {
  const nostr = useNostrOptional()
  return useMemo(
    () => userWriteOutboxUrls(nostr?.relayList, nostr?.cacheRelayListEvent),
    [nostr?.relayList, nostr?.cacheRelayListEvent]
  )
}
