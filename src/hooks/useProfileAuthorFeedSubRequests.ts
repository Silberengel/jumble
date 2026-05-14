import { buildProfileAuthorSubRequestsFromUrlGroups } from '@/lib/profile-author-subrequests'
import { buildProfilePageReadRelayUrls } from '@/lib/favorites-feed-relays'
import { hexPubkeysEqual, normalizeHexPubkey } from '@/lib/pubkey'
import { normalizeAnyRelayUrl } from '@/lib/url'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostrOptional } from '@/providers/nostr-context'
import client from '@/services/client.service'
import type { TFeedSubRequest } from '@/types'
import { isSocialKindBlockedKind } from '@/constants'
import { useCallback, useEffect, useMemo, useState } from 'react'

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

  const includeAuthorLocalRelays = useMemo(() => {
    const me = nostr?.pubkey?.trim()
    if (!me) return false
    try {
      return hexPubkeysEqual(normalizeHexPubkey(me), normalizeHexPubkey(pubkey))
    } catch {
      return false
    }
  }, [nostr?.pubkey, pubkey])

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
  const [provisionalUrls, setProvisionalUrls] = useState<string[]>([])
  const [fullUrls, setFullUrls] = useState<string[] | null>(null)

  useEffect(() => {
    let cancelled = false
    const socialKinds = kinds.some(isSocialKindBlockedKind)
    const provisional = buildProfilePageReadRelayUrls(
      favoriteRelays,
      blockedRelays,
      emptyAuthor,
      socialKinds,
      includeAuthorLocalRelays,
      kinds
    )
    if (!cancelled) {
      setProvisionalUrls(provisional)
      setFullUrls(null)
    }

    void client
      .fetchRelayList(pubkey)
      .catch(() => emptyAuthor)
      .then((authorRl) => {
        if (cancelled) return
        const full = buildProfilePageReadRelayUrls(
          favoriteRelays,
          blockedRelays,
          authorRl,
          socialKinds,
          includeAuthorLocalRelays,
          kinds
        )
        setFullUrls(full)
      })

    return () => {
      cancelled = true
    }
    // `relayListsKey` already fingerprints `favoriteRelays` + `blockedRelays` by sorted URL content.
    // Do not list those arrays here: the provider often hands new `[]` references each render and would
    // retrigger this effect forever (setState → re-render → new refs → effect → …).
  }, [pubkey, relayListsKey, kindsKey, kinds, refreshToken, includeAuthorLocalRelays])

  const activeUrls = fullUrls?.length ? fullUrls : provisionalUrls

  const subRequests = useMemo(() => {
    if (!activeUrls.length) return [] as TFeedSubRequest[]
    return buildProfileAuthorSubRequestsFromUrlGroups([activeUrls], authorHex, [...kinds], limit)
  }, [activeUrls, authorHex, kinds, limit])

  const followingFeedDeltaSubRequests = useMemo(() => [] as TFeedSubRequest[], [])

  const feedSubscriptionKey = useMemo(() => {
    return `profile-posts-${authorHex}-${kindsKey}-${limit}`
  }, [authorHex, kindsKey, limit])

  const refresh = useCallback(() => {
    setRefreshToken((n) => n + 1)
  }, [])

  return {
    subRequests,
    followingFeedDeltaSubRequests,
    feedSubscriptionKey,
    refresh
  }
}
