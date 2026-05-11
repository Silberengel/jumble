import { buildProfileAuthorSubRequestsFromUrlGroups } from '@/lib/profile-author-subrequests'
import { buildProfilePageReadRelayUrls } from '@/lib/favorites-feed-relays'
import { computeSpellSubRequestsIdentityKey } from '@/lib/spell-feed-request-identity'
import { hexPubkeysEqual, normalizeHexPubkey } from '@/lib/pubkey'
import { normalizeAnyRelayUrl, subtractNormalizedRelayUrls } from '@/lib/url'
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
  }, [pubkey, relayListsKey, kindsKey, kinds, refreshToken, favoriteRelays, blockedRelays, includeAuthorLocalRelays])

  const subRequests = useMemo(() => {
    if (!provisionalUrls.length) return [] as TFeedSubRequest[]
    return buildProfileAuthorSubRequestsFromUrlGroups([provisionalUrls], authorHex, [...kinds], limit)
  }, [provisionalUrls, authorHex, kinds, limit])

  const followingFeedDeltaSubRequests = useMemo(() => {
    if (!fullUrls?.length || !provisionalUrls.length) return [] as TFeedSubRequest[]
    const delta = subtractNormalizedRelayUrls(fullUrls, provisionalUrls)
    if (!delta.length) return [] as TFeedSubRequest[]
    return buildProfileAuthorSubRequestsFromUrlGroups([delta], authorHex, [...kinds], limit)
  }, [fullUrls, provisionalUrls, authorHex, kinds, limit])

  const feedSubscriptionKey = useMemo(() => {
    const base = computeSpellSubRequestsIdentityKey(subRequests)
    return `profile-posts-${authorHex}-${relayListsKey}-${base}`
  }, [authorHex, relayListsKey, subRequests])

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
