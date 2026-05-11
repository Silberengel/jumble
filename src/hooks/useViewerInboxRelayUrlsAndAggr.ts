import { userReadRelaysWithHttp } from '@/lib/favorites-feed-relays'
import { viewerMayUseNostrLandAggr } from '@/lib/nostr-land-aggr'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostrOptional } from '@/providers/nostr-context'
import client from '@/services/client.service'
import type { TRelayList } from '@/types'
import { useEffect, useMemo, useState } from 'react'

/**
 * Viewer NIP-65 read inboxes (incl. HTTP read) for embed / thread fan-out, plus whether they may use
 * {@link AGGR_NOSTR_LAND_WSS} (nostr.land in favorites or NIP-65 lists).
 */
export function useViewerInboxRelayUrlsAndAggrEligibility(): {
  inboxRelayUrls: string[]
  allowNostrLandAggr: boolean
} {
  const nostr = useNostrOptional()
  const pk = nostr?.pubkey?.trim()
  const { favoriteRelays } = useFavoriteRelays()
  const [inboxRelayUrls, setInboxRelayUrls] = useState<string[]>([])
  const [peekedNip65, setPeekedNip65] = useState<TRelayList | null>(null)

  useEffect(() => {
    if (!pk) {
      setInboxRelayUrls([])
      setPeekedNip65(null)
      return
    }
    let cancelled = false
    void client.peekRelayListFromStorage(pk).then((rl) => {
      if (cancelled) return
      setPeekedNip65(rl)
      setInboxRelayUrls(userReadRelaysWithHttp(rl).slice(0, 14))
    })
    return () => {
      cancelled = true
    }
  }, [pk])

  const allowNostrLandAggr = useMemo(
    () => viewerMayUseNostrLandAggr(favoriteRelays ?? [], peekedNip65 ?? undefined),
    [favoriteRelays, peekedNip65]
  )

  return { inboxRelayUrls, allowNostrLandAggr }
}
