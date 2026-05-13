import { FAST_READ_RELAY_URLS } from '@/constants'
import { feedRelayPolicyUrls } from '@/features/feed/relay-policy'
import { getRelayListFromEvent, getHttpRelayListFromEvent } from '@/lib/event-metadata'
import { buildAllFavoritesFeedRelayUrls } from '@/lib/home-feed-relays'
import logger from '@/lib/logger'
import { AGGR_NOSTR_LAND_WSS } from '@/lib/nostr-land-aggr'
import { normalizeAnyRelayUrl } from '@/lib/url'
import { buildWispTrendingNotesRelayUrl } from '@/lib/wisp-trending-relay'
import { useEffect, useMemo, useState, useCallback } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { FeedContext } from './feed-context'
import { useFavoriteRelays } from './FavoriteRelaysProvider'
import { useNostr } from './NostrProvider'

export type { TFeedContext } from './feed-context'

function relayUrlListIdentity(urls: string[]): string {
  return urls
    .map((u) => normalizeAnyRelayUrl(u) || u.trim())
    .filter(Boolean)
    .sort()
    .join('\n')
}

function relayListMentionsNostrLand(urls: readonly string[]): boolean {
  return urls.some((url) => {
    const normalized = normalizeAnyRelayUrl(url) || url.trim()
    if (!normalized) return false
    try {
      const parsed = new URL(normalized.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://'))
      return parsed.hostname.toLowerCase() === 'nostr.land'
    } catch {
      return false
    }
  })
}

function buildHomeReplyFeedRelayUrls(
  primaryRelayUrls: string[],
  inboxRelayUrls: string[],
  cacheRelayUrls: string[],
  httpRelayUrls: string[],
  includeNostrLandAggr: boolean,
  blockedRelays: string[]
): string[] {
  return feedRelayPolicyUrls([
    { source: 'favorites', urls: primaryRelayUrls },
    { source: 'viewer-read', urls: inboxRelayUrls },
    { source: 'cache', urls: cacheRelayUrls },
    { source: 'http-index', urls: httpRelayUrls },
    ...(includeNostrLandAggr ? [{ source: 'read-only', urls: [AGGR_NOSTR_LAND_WSS] }] : [])
  ], {
    operation: 'read',
    blockedRelays,
    nostrLandAggr: 'never',
    applySocialKindBlockedFilter: false,
    allowThirdPartyLocalRelays: true
  })
}

export function FeedProvider({ children }: { children: ReactNode }) {
  const { isInitialized, relayList, cacheRelayListEvent, httpRelayListEvent } = useNostr()
  const { favoriteRelays, blockedRelays, relaySets } = useFavoriteRelays()

  const favoriteFeedRelayUrls = useMemo(
    () => [...favoriteRelays, ...relaySets.flatMap((relaySet) => relaySet.relayUrls)],
    [favoriteRelays, relaySets]
  )

  /** Home Notes/Gallery stay focused: favorites/defaults plus the mixed trending relay. */
  const primaryExtraRelayUrls = useMemo(() => [buildWispTrendingNotesRelayUrl()], [])

  /** Home Replies widen to relays that can surface inbox/reply context. */
  const replyExtraRelayLayers = useMemo(() => {
    const cacheRelayUrls: string[] = []
    if (cacheRelayListEvent) {
      const list = getRelayListFromEvent(cacheRelayListEvent, blockedRelays)
      cacheRelayUrls.push(...list.read, ...list.write)
    }

    const httpRelayUrls: string[] = [...(relayList?.httpRead ?? []), ...(relayList?.httpWrite ?? [])]
    if (httpRelayListEvent) {
      const list = getHttpRelayListFromEvent(httpRelayListEvent, blockedRelays)
      httpRelayUrls.push(...list.httpRead, ...list.httpWrite)
    }

    return {
      inboxRelayUrls: relayList?.read?.length ? relayList.read : FAST_READ_RELAY_URLS,
      outboxRelayUrls: relayList?.write?.length ? relayList.write : FAST_READ_RELAY_URLS,
      cacheRelayUrls,
      httpRelayUrls
    }
  }, [relayList, cacheRelayListEvent, httpRelayListEvent, blockedRelays])

  /** Default relays immediately so feeds / sidebar REQ never wait on Nostr session restore. */
  const [relayUrls, setRelayUrls] = useState<string[]>(() =>
    buildAllFavoritesFeedRelayUrls([], [], [buildWispTrendingNotesRelayUrl()])
  )
  const [replyRelayUrls, setReplyRelayUrls] = useState<string[]>(() =>
    buildHomeReplyFeedRelayUrls(
      buildAllFavoritesFeedRelayUrls([], [], [buildWispTrendingNotesRelayUrl()]),
      [],
      [],
      [],
      false,
      []
    )
  )
  /** Same logical relay policy result — reuse array ref so NoteList does not re-subscribe. */
  const setUrlStateIfChanged = useCallback(
    (setter: Dispatch<SetStateAction<string[]>>, next: string[]) => {
      setter((prev) => {
        if (relayUrlListIdentity(prev) === relayUrlListIdentity(next)) return prev
        return next
      })
    },
    []
  )

  const updateFeedRelayUrls = useCallback(() => {
    const primaryRelays = buildAllFavoritesFeedRelayUrls(favoriteFeedRelayUrls, blockedRelays, primaryExtraRelayUrls)
    const aggrEligibleRelayUrls = [
      ...favoriteFeedRelayUrls,
      ...replyExtraRelayLayers.inboxRelayUrls,
      ...replyExtraRelayLayers.outboxRelayUrls,
      ...replyExtraRelayLayers.cacheRelayUrls
    ]
    const replyRelays = buildHomeReplyFeedRelayUrls(
      primaryRelays,
      replyExtraRelayLayers.inboxRelayUrls,
      replyExtraRelayLayers.cacheRelayUrls,
      replyExtraRelayLayers.httpRelayUrls,
      relayListMentionsNostrLand(aggrEligibleRelayUrls),
      blockedRelays
    )
    logger.debug('Updating home feed relay URLs:', {
      primaryRelays,
      replyRelays
    })
    setUrlStateIfChanged(setRelayUrls, primaryRelays)
    setUrlStateIfChanged(setReplyRelayUrls, replyRelays)
  }, [favoriteFeedRelayUrls, blockedRelays, primaryExtraRelayUrls, replyExtraRelayLayers, setUrlStateIfChanged])

  const favoriteRelaysIdentity = useMemo(
    () =>
      [...favoriteFeedRelayUrls]
        .map((u) => normalizeAnyRelayUrl(u) || u.trim())
        .filter(Boolean)
        .sort()
        .join('|'),
    [favoriteFeedRelayUrls]
  )
  const blockedRelaysIdentity = useMemo(
    () =>
      [...blockedRelays]
        .map((u) => normalizeAnyRelayUrl(u) || u.trim())
        .filter(Boolean)
        .sort()
        .join('|'),
    [blockedRelays]
  )
  const replyExtraRelaysIdentity = useMemo(
    () =>
      [
        ...replyExtraRelayLayers.inboxRelayUrls,
        ...replyExtraRelayLayers.outboxRelayUrls,
        ...replyExtraRelayLayers.cacheRelayUrls,
        ...replyExtraRelayLayers.httpRelayUrls
      ]
        .map((u) => normalizeAnyRelayUrl(u) || u.trim())
        .filter(Boolean)
        .sort()
        .join('|'),
    [replyExtraRelayLayers]
  )
  useEffect(() => {
    logger.debug('FeedProvider relay init:', {
      isInitialized,
      favoriteRelays: favoriteRelays.length,
      relaySets: relaySets.length,
      relaySetRelays: favoriteFeedRelayUrls.length - favoriteRelays.length,
      inboxRelays: replyExtraRelayLayers.inboxRelayUrls.length,
      outboxRelays: replyExtraRelayLayers.outboxRelayUrls.length,
      cacheRelays: replyExtraRelayLayers.cacheRelayUrls.length,
      httpRelays: replyExtraRelayLayers.httpRelayUrls.length,
      blockedRelays: blockedRelays.length
    })

    if (favoriteFeedRelayUrls.length === 0) {
      logger.debug('FeedProvider: no favorite or relay-set relays, using defaults')
    }

    updateFeedRelayUrls()
  }, [isInitialized, favoriteRelaysIdentity, blockedRelaysIdentity, replyExtraRelaysIdentity, updateFeedRelayUrls])

  return (
    <FeedContext.Provider
      value={{
        relayUrls,
        replyRelayUrls
      }}
    >
      {children}
    </FeedContext.Provider>
  )
}
