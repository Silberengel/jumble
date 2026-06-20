import { buildAccountListRelayUrlsForMerge } from '@/lib/account-list-relay-urls'
import { fetchViewerBooklistTargets } from '@/lib/booklist-label'
import { buildLibraryRelayUrls } from '@/lib/library-publication-index'
import { fetchNewestPinListForPubkey } from '@/lib/replaceable-list-latest'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'
import type { Event } from 'nostr-tools'
import { useCallback, useEffect, useState } from 'react'
import { EMPTY_BOOKLIST_TARGETS } from './constants'

export function useLibraryViewerData(isActive: boolean) {
  const { pubkey } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const [pinListEvent, setPinListEvent] = useState<Event | null>(null)
  const [myBooklistTargets, setMyBooklistTargets] = useState(EMPTY_BOOKLIST_TARGETS)
  const [booklistTargetsLoading, setBooklistTargetsLoading] = useState(false)

  const loadMyBooklistTargets = useCallback(async () => {
    if (!pubkey) {
      setMyBooklistTargets(EMPTY_BOOKLIST_TARGETS)
      setBooklistTargetsLoading(false)
      return
    }
    setBooklistTargetsLoading(true)
    try {
      const relays = await buildAccountListRelayUrlsForMerge({
        accountPubkey: pubkey,
        favoriteRelays: favoriteRelays ?? [],
        blockedRelays: blockedRelays ?? []
      })
      const targets = await fetchViewerBooklistTargets(pubkey, relays)
      setMyBooklistTargets(targets)
    } finally {
      setBooklistTargetsLoading(false)
    }
  }, [pubkey, favoriteRelays, blockedRelays])

  useEffect(() => {
    if (!pubkey) {
      setPinListEvent(null)
      setMyBooklistTargets(EMPTY_BOOKLIST_TARGETS)
      return
    }
    let cancelled = false
    void (async () => {
      const relays = await buildLibraryRelayUrls(pubkey, blockedRelays ?? [])
      const pinList = await fetchNewestPinListForPubkey(pubkey, relays)
      if (!cancelled) setPinListEvent(pinList ?? null)
    })()
    if (isActive) {
      void loadMyBooklistTargets()
    } else {
      setMyBooklistTargets(EMPTY_BOOKLIST_TARGETS)
    }
    return () => {
      cancelled = true
    }
  }, [pubkey, blockedRelays, isActive, loadMyBooklistTargets])

  return {
    pinListEvent,
    myBooklistTargets,
    booklistTargetsLoading,
    loadMyBooklistTargets
  }
}
