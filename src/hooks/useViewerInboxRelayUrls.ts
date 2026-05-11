import { userReadRelaysWithHttp } from '@/lib/favorites-feed-relays'
import { useNostrOptional } from '@/providers/nostr-context'
import client from '@/services/client.service'
import { useEffect, useState } from 'react'

/** Viewer NIP-65 read inboxes (incl. HTTP read) for embed / thread fan-out. */
export function useViewerInboxRelayUrls(): {
  inboxRelayUrls: string[]
} {
  const nostr = useNostrOptional()
  const pk = nostr?.pubkey?.trim()
  const [inboxRelayUrls, setInboxRelayUrls] = useState<string[]>([])

  useEffect(() => {
    if (!pk) {
      setInboxRelayUrls([])
      return
    }
    let cancelled = false
    void client.peekRelayListFromStorage(pk).then((rl) => {
      if (cancelled) return
      setInboxRelayUrls(userReadRelaysWithHttp(rl).slice(0, 14))
    })
    return () => {
      cancelled = true
    }
  }, [pk])

  return { inboxRelayUrls }
}
