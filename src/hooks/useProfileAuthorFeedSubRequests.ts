import { buildProfileAuthorSubRequestsFromUrlGroups } from '@/lib/profile-author-subrequests'
import { isSocialKindBlockedKind } from '@/constants'
import { useGlobalRelayBootstrapDefaults } from '@/hooks/use-global-relay-bootstrap-defaults'
import { buildProfilePageReadRelayUrls } from '@/lib/favorites-feed-relays'
import { hexPubkeysEqual, normalizeHexPubkey } from '@/lib/pubkey'
import { normalizeAnyRelayUrl } from '@/lib/url'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostrOptional } from '@/providers/nostr-context'
import client from '@/services/client.service'
import type { TFeedSubRequest } from '@/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

function relayListsContentKey(favoriteRelays: string[], blockedRelays: string[]): string {
  const fav = [...favoriteRelays].map((u) => normalizeAnyRelayUrl(u) || u).filter(Boolean).sort().join('\u0001')
  const blk = [...blockedRelays].map((u) => normalizeAnyRelayUrl(u) || u).filter(Boolean).sort().join('\u0001')
  return `${fav}\u0000${blk}`
}

const emptyAuthor = {
  read: [] as string[],
  write: [] as string[],
  httpRead: [] as string[],
  httpWrite: [] as string[]
}

export type UseProfileAuthorFeedSubRequestsOptions = {
  pubkey: string
  /** REQ kinds (e.g. {@link PROFILE_POSTS_TAB_KINDS}) — stable for the Posts tab. */
  kinds: readonly number[]
  limit?: number
}

export function useProfileAuthorFeedSubRequests({
  pubkey,
  kinds,
  limit = 200
}: UseProfileAuthorFeedSubRequestsOptions): {
  subRequests: TFeedSubRequest[]
  followingFeedDeltaSubRequests: TFeedSubRequest[]
  feedSubscriptionKey: string
  refresh: () => void
} {
  const nostr = useNostrOptional()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const viewerUsesGlobalBootstrap = useGlobalRelayBootstrapDefaults()

  const includeAuthorLocalRelays = useMemo(() => {
    const me = nostr?.pubkey?.trim()
    if (!me) return false
    try {
      return hexPubkeysEqual(normalizeHexPubkey(me), normalizeHexPubkey(pubkey))
    } catch {
      return false
    }
  }, [nostr?.pubkey, pubkey])

  /** Own profile: honor viewer relay prefs. Other profiles: always widen with FAST_READ / profile index relays. */
  const useGlobalRelayBootstrap = viewerUsesGlobalBootstrap || !includeAuthorLocalRelays

  const relayListsKey = useMemo(
    () => relayListsContentKey(favoriteRelays, blockedRelays),
    [favoriteRelays, blockedRelays]
  )

  const kindsKey = useMemo(() => [...kinds].join(','), [kinds])

  const authorHex = useMemo(() => {
    try {
      return normalizeHexPubkey(pubkey)
    } catch {
      return pubkey.trim()
    }
  }, [pubkey])

  const [refreshToken, setRefreshToken] = useState(0)
  /** Single emission per visit: provisional→full relay stacks used to restart NoteList and wipe rows mid-fetch. */
  const [relayUrls, setRelayUrls] = useState<string[] | null>(null)
  const relayUrlsPubkeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (relayUrlsPubkeyRef.current !== pubkey) {
      relayUrlsPubkeyRef.current = pubkey
      setRelayUrls(null)
    }
  }, [pubkey])

  useEffect(() => {
    let cancelled = false
    const socialKinds = kinds.some(isSocialKindBlockedKind)

    void client
      .fetchRelayList(pubkey)
      .catch(() => emptyAuthor)
      .then((authorRl) => {
        if (cancelled) return
        const urls = buildProfilePageReadRelayUrls(
          favoriteRelays,
          blockedRelays,
          authorRl,
          socialKinds,
          includeAuthorLocalRelays,
          kinds,
          useGlobalRelayBootstrap
        )
        setRelayUrls(urls)
      })

    return () => {
      cancelled = true
    }
  }, [pubkey, relayListsKey, kindsKey, kinds, refreshToken, includeAuthorLocalRelays, useGlobalRelayBootstrap])

  const subRequests = useMemo(() => {
    if (!relayUrls?.length) return [] as TFeedSubRequest[]
    return buildProfileAuthorSubRequestsFromUrlGroups([relayUrls], authorHex, [...kinds], limit)
  }, [relayUrls, authorHex, kinds, limit])

  const followingFeedDeltaSubRequests = useMemo(() => [] as TFeedSubRequest[], [])

  const feedSubscriptionKey = useMemo(() => {
    return `profile-posts-${authorHex}-${kindsKey}-${limit}`
  }, [authorHex, kindsKey, limit])

  const refresh = useCallback(() => {
    setRelayUrls(null)
    setRefreshToken((n) => n + 1)
  }, [])

  return {
    subRequests,
    followingFeedDeltaSubRequests,
    feedSubscriptionKey,
    refresh
  }
}
