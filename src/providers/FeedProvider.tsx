import { FAST_READ_RELAY_URLS } from '@/constants'
import { feedRelayPolicyUrls } from '@/features/feed/relay-policy'
import { getRelayListFromEvent, getHttpRelayListFromEvent } from '@/lib/event-metadata'
import { buildAllFavoritesFeedRelayUrls } from '@/lib/home-feed-relays'
import logger from '@/lib/logger'
import { syncViewerRelayStackNostrLandAggrEligible } from '@/lib/nostr-land-relay-eligibility'
import { normalizeAnyRelayUrl } from '@/lib/url'
import { buildWispTrendingNotesRelayUrl } from '@/lib/wisp-trending-relay'
import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
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

function buildHomeReplyFeedRelayUrls(
  primaryRelayUrls: string[],
  inboxRelayUrls: string[],
  cacheRelayUrls: string[],
  httpRelayUrls: string[],
  blockedRelays: string[]
): string[] {
  return feedRelayPolicyUrls(
    [
      { source: 'favorites', urls: primaryRelayUrls },
      { source: 'viewer-read', urls: inboxRelayUrls },
      { source: 'cache', urls: cacheRelayUrls },
      { source: 'http-index', urls: httpRelayUrls }
    ],
    {
      operation: 'read',
      blockedRelays,
      applySocialKindBlockedFilter: false,
      allowThirdPartyLocalRelays: true
    }
  )
}

export function FeedProvider({ children }: { children: ReactNode }) {
  const { isInitialized, relayList, cacheRelayListEvent, httpRelayListEvent } = useNostr()
  const { favoriteRelays, blockedRelays, relaySets } = useFavoriteRelays()

  const favoriteFeedRelayUrls = useMemo(
    () => [...favoriteRelays, ...relaySets.flatMap((relaySet) => relaySet.relayUrls)],
    [favoriteRelays, relaySets]
  )

  /**
   * Mixed trending slice (nostrarchives / Wisp-style feed) so the home timeline isn’t only the user’s
   * graph — keeps a finger on what the wider network is surfacing, alongside favorites / NIP-65.
   */
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

  const viewerNostrLandAggrEligible = useMemo(() => {
    const urls = [
      ...favoriteFeedRelayUrls,
      ...replyExtraRelayLayers.inboxRelayUrls,
      ...replyExtraRelayLayers.outboxRelayUrls,
      ...replyExtraRelayLayers.cacheRelayUrls,
      ...replyExtraRelayLayers.httpRelayUrls
    ]
    return syncViewerRelayStackNostrLandAggrEligible(urls)
  }, [favoriteFeedRelayUrls, replyExtraRelayLayers])

  const lastHomeFeedUrlLogRef = useRef({ primary: '', reply: '' })
  const updateFeedRelayUrls = useCallback(() => {
    const primaryRelays = buildAllFavoritesFeedRelayUrls(favoriteFeedRelayUrls, blockedRelays, primaryExtraRelayUrls)
    const replyRelays = buildHomeReplyFeedRelayUrls(
      primaryRelays,
      replyExtraRelayLayers.inboxRelayUrls,
      replyExtraRelayLayers.cacheRelayUrls,
      replyExtraRelayLayers.httpRelayUrls,
      blockedRelays
    )
    const primaryId = relayUrlListIdentity(primaryRelays)
    const replyId = relayUrlListIdentity(replyRelays)
    const prevUrls = lastHomeFeedUrlLogRef.current
    if (prevUrls.primary !== primaryId || prevUrls.reply !== replyId) {
      lastHomeFeedUrlLogRef.current = { primary: primaryId, reply: replyId }
      logger.debug('Updating home feed relay URLs:', {
        primaryRelays,
        replyRelays
      })
    }
    setUrlStateIfChanged(setRelayUrls, primaryRelays)
    setUrlStateIfChanged(setReplyRelayUrls, replyRelays)
  }, [
    favoriteFeedRelayUrls,
    blockedRelays,
    primaryExtraRelayUrls,
    replyExtraRelayLayers,
    setUrlStateIfChanged,
    viewerNostrLandAggrEligible
  ])

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
  const lastRelayInitDebugKey = useRef('')
  const lastHadFavoriteRelaysRef = useRef<boolean | null>(null)
  const relayUrlDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const initKey = [
      isInitialized ? '1' : '0',
      favoriteRelays.length,
      relaySets.length,
      favoriteFeedRelayUrls.length - favoriteRelays.length,
      replyExtraRelayLayers.inboxRelayUrls.length,
      replyExtraRelayLayers.outboxRelayUrls.length,
      replyExtraRelayLayers.cacheRelayUrls.length,
      replyExtraRelayLayers.httpRelayUrls.length,
      blockedRelays.length
    ].join('\x1e')

    const flush = () => {
      if (initKey !== lastRelayInitDebugKey.current) {
        lastRelayInitDebugKey.current = initKey
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
      }

      const hasFavoriteRelays = favoriteFeedRelayUrls.length > 0
      const prevHad = lastHadFavoriteRelaysRef.current
      lastHadFavoriteRelaysRef.current = hasFavoriteRelays
      if (!hasFavoriteRelays && prevHad !== false) {
        logger.debug('FeedProvider: no favorite or relay-set relays, using defaults')
      }

      updateFeedRelayUrls()
    }

    if (relayUrlDebounceTimerRef.current) {
      clearTimeout(relayUrlDebounceTimerRef.current)
    }
    relayUrlDebounceTimerRef.current = setTimeout(() => {
      relayUrlDebounceTimerRef.current = null
      flush()
    }, 80)

    return () => {
      if (relayUrlDebounceTimerRef.current) {
        clearTimeout(relayUrlDebounceTimerRef.current)
        relayUrlDebounceTimerRef.current = null
      }
    }
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
