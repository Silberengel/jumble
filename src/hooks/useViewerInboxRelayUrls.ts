import { collectViewerReadInboxUrls } from '@/lib/viewer-read-inboxes'
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
      void collectViewerReadInboxUrls(pk, rl).then((urls) => {
        if (cancelled) return
        setInboxRelayUrls(urls.slice(0, 14))
      })
    })
    return () => {
      cancelled = true
    }
  }, [pk])

  return { inboxRelayUrls }
}
