import { buildProfileAuthorSubRequestsFromUrlGroups } from '@/lib/profile-author-subrequests'
import { isSocialKindBlockedKind } from '@/constants'
import { useGlobalRelayBootstrapDefaults } from '@/hooks/use-global-relay-bootstrap-defaults'
import { buildProfilePageReadRelayUrls } from '@/lib/favorites-feed-relays'
import { hexPubkeysEqual, isValidPubkey, normalizeHexPubkey, userIdToPubkey } from '@/lib/pubkey'
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

function relayUrlListKey(urls: readonly string[]): string {
  return [...urls]
    .map((u) => normalizeAnyRelayUrl(u) || u)
    .filter(Boolean)
    .sort()
    .join('\u0001')
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
    const pk = userIdToPubkey(pubkey)
    return isValidPubkey(pk) ? pk : ''
  }, [pubkey])

  const [refreshToken, setRefreshToken] = useState(0)
  /** Single emission per visit: provisional→full relay stacks used to restart NoteList and wipe rows mid-fetch. */
  const [relayUrls, setRelayUrls] = useState<string[] | null>(null)
  const relayUrlsPubkeyRef = useRef<string | null>(null)
  const appliedRelayUrlsKeyRef = useRef('')

  useEffect(() => {
    if (relayUrlsPubkeyRef.current !== pubkey) {
      relayUrlsPubkeyRef.current = pubkey
      appliedRelayUrlsKeyRef.current = ''
      setRelayUrls(null)
    }
  }, [pubkey])

  useEffect(() => {
    let cancelled = false
    const socialKinds = kinds.some(isSocialKindBlockedKind)

    const applyRelayList = (authorRl: typeof emptyAuthor) => {
      const urls = buildProfilePageReadRelayUrls(
        favoriteRelays,
        blockedRelays,
        authorRl,
        socialKinds,
        includeAuthorLocalRelays,
        kinds,
        useGlobalRelayBootstrap
      )
      if (urls.length === 0) return
      const key = relayUrlListKey(urls)
      if (key === appliedRelayUrlsKeyRef.current) return
      appliedRelayUrlsKeyRef.current = key
      setRelayUrls(urls)
    }

    // Bootstrap immediately (favorites + fast-read) so /users/… feeds are not stuck on "Nothing to load"
    // while fetchRelayList runs (often 10–30s under relay contention).
    applyRelayList(emptyAuthor)

    void client
      .peekRelayListFromStorage(pubkey)
      .then((cached) => {
        if (cancelled) return
        applyRelayList(cached)
      })
      .catch(() => {})

    void client
      .fetchRelayList(pubkey)
      .catch(() => emptyAuthor)
      .then((authorRl) => {
        if (cancelled) return
        applyRelayList(authorRl)
      })

    return () => {
      cancelled = true
    }
  }, [pubkey, relayListsKey, kindsKey, kinds, refreshToken, includeAuthorLocalRelays, useGlobalRelayBootstrap])

  const subRequests = useMemo(() => {
    if (!relayUrls?.length || !authorHex) return [] as TFeedSubRequest[]
    return buildProfileAuthorSubRequestsFromUrlGroups([relayUrls], authorHex, [...kinds], limit)
  }, [relayUrls, authorHex, kinds, limit])

  const followingFeedDeltaSubRequests = useMemo(() => [] as TFeedSubRequest[], [])

  const feedSubscriptionKey = useMemo(() => {
    return `profile-feed-${authorHex}-${kindsKey}-${limit}`
  }, [authorHex, kindsKey, limit])

  const refresh = useCallback(() => {
    appliedRelayUrlsKeyRef.current = ''
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
