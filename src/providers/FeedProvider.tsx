import { feedRelayPolicyUrls } from '@/features/feed/relay-policy'
import { getFavoritesFeedRelayUrls } from '@/lib/favorites-feed-relays'
import { getRelayListFromEvent, getHttpRelayListFromEvent } from '@/lib/event-metadata'
import logger from '@/lib/logger'
import { normalizeAnyRelayUrl } from '@/lib/url'
import { buildWispTrendingNotesRelayUrl } from '@/lib/wisp-trending-relay'
import { useEffect, useMemo, useState, useCallback } from 'react'
import { FeedContext } from './feed-context'
import { useFavoriteRelays } from './FavoriteRelaysProvider'
import { useNostr } from './NostrProvider'

export { useFeed } from './feed-context'
export type { TFeedContext } from './feed-context'

function relayUrlListIdentity(urls: string[]): string {
  return urls
    .map((u) => normalizeAnyRelayUrl(u) || u.trim())
    .filter(Boolean)
    .sort()
    .join('\n')
}

function buildAllFavoritesFeedRelayUrls(
  favoriteRelays: string[],
  blockedRelays: string[],
  extraFeedRelayUrls: string[]
): string[] {
  return feedRelayPolicyUrls([
    { source: 'favorites', urls: getFavoritesFeedRelayUrls(favoriteRelays, blockedRelays) },
    { source: 'fallback', urls: extraFeedRelayUrls }
  ], {
    operation: 'favorites-feed',
    blockedRelays,
    nostrLandAggr: 'never',
    applySocialKindBlockedFilter: false,
    allowThirdPartyLocalRelays: true
  })
}

export function FeedProvider({ children }: { children: React.ReactNode }) {
  const { isInitialized, cacheRelayListEvent, httpRelayListEvent } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()

  /**
   * Extra relay URLs always merged into the all-favorites feed:
   * - Cache relays (kind 10432) if the user has configured any
   * - HTTP index relays (kind 10243) if the user has configured any
   * - The Wisp trending relay (always included)
   */
  const extraFeedRelayUrls = useMemo(() => {
    const extra: string[] = [buildWispTrendingNotesRelayUrl()]
    if (cacheRelayListEvent) {
      const list = getRelayListFromEvent(cacheRelayListEvent)
      extra.push(...list.read, ...list.write)
    }
    if (httpRelayListEvent) {
      const list = getHttpRelayListFromEvent(httpRelayListEvent)
      extra.push(...list.httpRead, ...list.httpWrite)
    }
    return extra
  }, [cacheRelayListEvent, httpRelayListEvent])
  /** Default relays immediately so feeds / sidebar REQ never wait on Nostr session restore. */
  const [relayUrls, setRelayUrls] = useState<string[]>(() =>
    buildAllFavoritesFeedRelayUrls([], [], [buildWispTrendingNotesRelayUrl()])
  )
  /** Same logical relay policy result — reuse array ref so NoteList does not re-subscribe. */
  const setRelayUrlsIfChanged = useCallback((next: string[]) => {
    setRelayUrls((prev) => {
      if (relayUrlListIdentity(prev) === relayUrlListIdentity(next)) return prev
      return next
    })
  }, [])

  const updateFeedRelayUrls = useCallback(() => {
    const finalRelays = buildAllFavoritesFeedRelayUrls(favoriteRelays, blockedRelays, extraFeedRelayUrls)
    logger.debug('Updating all-favorites relay URLs:', finalRelays)
    setRelayUrlsIfChanged(finalRelays)
  }, [favoriteRelays, blockedRelays, extraFeedRelayUrls, setRelayUrlsIfChanged])

  const favoriteRelaysIdentity = useMemo(
    () =>
      [...favoriteRelays]
        .map((u) => normalizeAnyRelayUrl(u) || u.trim())
        .filter(Boolean)
        .sort()
        .join('|'),
    [favoriteRelays]
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
  useEffect(() => {
    logger.debug('FeedProvider relay init:', {
      isInitialized,
      favoriteRelays: favoriteRelays.length,
      blockedRelays: blockedRelays.length
    })

    if (favoriteRelays.length === 0) {
      logger.debug('FeedProvider: favoriteRelays is empty, using defaults')
    }

    updateFeedRelayUrls()
  }, [isInitialized, favoriteRelaysIdentity, blockedRelaysIdentity, updateFeedRelayUrls])

  return (
    <FeedContext.Provider
      value={{
        relayUrls
      }}
    >
      {children}
    </FeedContext.Provider>
  )
}
