import { getFavoritesFeedRelayUrls, mergeRelayUrlLayers } from '@/lib/favorites-feed-relays'
import { getRelaySetFromEvent, getRelayListFromEvent, getHttpRelayListFromEvent } from '@/lib/event-metadata'
import logger from '@/lib/logger'
import { isHttpRelayUrl, isWebsocketUrl, normalizeAnyRelayUrl } from '@/lib/url'
import { buildWispTrendingNotesRelayUrl } from '@/lib/wisp-trending-relay'
import indexedDb from '@/services/indexed-db.service'
import storage from '@/services/local-storage.service'
import { TFeedInfo, TFeedType } from '@/types'
import { kinds } from 'nostr-tools'
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
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

export function FeedProvider({ children }: { children: React.ReactNode }) {
  const { pubkey, isInitialized, cacheRelayListEvent, httpRelayListEvent } = useNostr()
  const { relaySets, favoriteRelays, blockedRelays } = useFavoriteRelays()

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
    mergeRelayUrlLayers([getFavoritesFeedRelayUrls([], []), [buildWispTrendingNotesRelayUrl()]], [])
  )
  const [isReady, setIsReady] = useState(true)
  const [feedInfo, setFeedInfo] = useState<TFeedInfo>({
    feedType: 'all-favorites'
  })
  const feedInfoRef = useRef<TFeedInfo>(feedInfo)
  /** Same logical list as {@link mergeRelayUrlLayers} result — reuse array ref so NoteList does not re-subscribe. */
  const setRelayUrlsIfChanged = useCallback((next: string[]) => {
    setRelayUrls((prev) => {
      if (relayUrlListIdentity(prev) === relayUrlListIdentity(next)) return prev
      return next
    })
  }, [])

  const switchFeed = useCallback(async (
    feedType: TFeedType,
    options: {
      activeRelaySetId?: string | null
      pubkey?: string | null
      relay?: string | null
    } = {}
  ) => {
    logger.debug('switchFeed called:', { feedType, options })
    if (feedType === 'relay') {
      const normalizedUrl = normalizeAnyRelayUrl(options.relay ?? '')
      const isRelayFeedUrl =
        !!normalizedUrl && (isHttpRelayUrl(normalizedUrl) || isWebsocketUrl(normalizedUrl))
      logger.debug('Relay switchFeed:', { normalizedUrl, isRelayFeedUrl, blockedRelays })

      if (!isRelayFeedUrl) {
        logger.debug('Invalid relay URL, setting isReady to true')
        setIsReady(true)
        return
      }
      
      // Don't allow selecting a blocked relay as feed
      if (blockedRelays.includes(normalizedUrl)) {
        logger.warn('Cannot select blocked relay as feed:', normalizedUrl)
        setIsReady(true)
        return
      }

      const newFeedInfo = { feedType, id: normalizedUrl }
      logger.component('FeedProvider', 'Setting relay feed info', newFeedInfo)
      setFeedInfo(newFeedInfo)
      feedInfoRef.current = newFeedInfo
      setRelayUrlsIfChanged([normalizedUrl])
      logger.component('FeedProvider', 'Set relayUrls', { relayUrls: [normalizedUrl] })
      storage.setFeedInfo(newFeedInfo, pubkey)
      // Reset note list mode to 'posts' when switching to relay feed to ensure main content is shown
      storage.setNoteListMode('posts')
      setIsReady(true)
      logger.component('FeedProvider', 'Relay feed setup complete, isReady set to true')
      return
    }
    if (feedType === 'relays') {
      const relaySetId = options.activeRelaySetId ?? (relaySets.length > 0 ? relaySets[0].id : null)
      if (!relaySetId || !pubkey) {
        setIsReady(true)
        return
      }

      let relaySet =
        relaySets.find((set) => set.id === relaySetId) ??
        (relaySets.length > 0 ? relaySets[0] : null)
      if (!relaySet) {
        const storedRelaySetEvent = await indexedDb.getReplaceableEvent(
          pubkey,
          kinds.Relaysets,
          relaySetId
        )
        if (storedRelaySetEvent) {
          relaySet = getRelaySetFromEvent(storedRelaySetEvent, blockedRelays)
        }
      }
      if (relaySet) {
        const newFeedInfo = { feedType, id: relaySet.id }
        setFeedInfo(newFeedInfo)
        feedInfoRef.current = newFeedInfo
        setRelayUrlsIfChanged(relaySet.relayUrls)
        storage.setFeedInfo(newFeedInfo, pubkey)
        // Reset note list mode to 'posts' when switching to relay set to ensure main content is shown
        storage.setNoteListMode('posts')
        setIsReady(true)
      }
      setIsReady(true)
      return
    }
    if (feedType === 'all-favorites') {
      const baseRelays = getFavoritesFeedRelayUrls(favoriteRelays, blockedRelays)
      const finalRelays = mergeRelayUrlLayers([baseRelays, extraFeedRelayUrls], blockedRelays)
      logger.debug('Switching to all-favorites, finalRelays:', finalRelays)
      const newFeedInfo = { feedType }
      setFeedInfo(newFeedInfo)
      feedInfoRef.current = newFeedInfo
      setRelayUrlsIfChanged(finalRelays)
      storage.setFeedInfo(newFeedInfo, pubkey)
      // Reset note list mode to 'posts' when switching to all-favorites to ensure main content is shown
      storage.setNoteListMode('posts')
      setIsReady(true)
      return
    }
    setIsReady(true)
  }, [pubkey, favoriteRelays, blockedRelays, relaySets, extraFeedRelayUrls, setRelayUrlsIfChanged])

  const switchFeedRef = useRef(switchFeed)
  switchFeedRef.current = switchFeed

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
  const relaySetsIdentity = useMemo(
    () =>
      relaySets
        .map((s) => {
          const urls = [...s.relayUrls]
            .map((u) => normalizeAnyRelayUrl(u) || u.trim())
            .filter(Boolean)
            .sort()
            .join(',')
          return `${s.id}:${urls}`
        })
        .sort()
        .join('\n'),
    [relaySets]
  )

  useEffect(() => {
    const init = async () => {
      logger.debug('FeedProvider init:', { isInitialized, pubkey, favoriteRelays: favoriteRelays.length, blockedRelays: blockedRelays.length })

      // Wait for favoriteRelays to be initialized (should have at least default relays)
      // If favoriteRelays is empty, it might not be initialized yet, so wait
      if (favoriteRelays.length === 0 && !pubkey) {
        // For anonymous users, favoriteRelays should be initialized from FAST_READ_RELAY_URLS
        // If it's still empty, something is wrong, but we'll use defaults
        logger.debug('FeedProvider: favoriteRelays is empty, using defaults')
      }

      let stored: TFeedInfo | null = null
      if (pubkey) {
        const fromStorage = storage.getFeedInfo(pubkey)
        logger.debug('Stored feed info:', fromStorage)
        if (fromStorage) stored = fromStorage
      }

      const storedFeedType = (stored as { feedType?: string } | null)?.feedType
      const migrateHomeToCombo =
        storedFeedType === 'following' ||
        storedFeedType === 'bookmarks' ||
        storedFeedType === 'relay' ||
        storedFeedType === 'relays'

      if (migrateHomeToCombo && pubkey) {
        const migrated: TFeedInfo = { feedType: 'all-favorites' }
        storage.setFeedInfo(migrated, pubkey)
        logger.info('[FeedProvider] Home feed uses combo (all-favorites); migrated stored selection', {
          previous: storedFeedType
        })
      }

      return await switchFeedRef.current('all-favorites')
    }

    void init()
  }, [pubkey, isInitialized, favoriteRelaysIdentity, blockedRelaysIdentity, relaySetsIdentity])

  // Update relay URLs when favoriteRelays, blocked, or extra relay lists change while in all-favorites mode
  useEffect(() => {
    if (feedInfo.feedType !== 'all-favorites') return
    const baseRelays = getFavoritesFeedRelayUrls(favoriteRelays, blockedRelays)
    const finalRelays = mergeRelayUrlLayers([baseRelays, extraFeedRelayUrls], blockedRelays)
    logger.debug('Updating relay URLs for all-favorites:', finalRelays)
    // Same logical list can be merged into a new array each run; keep the previous reference so
    // feed consumers (RelaysFeed → NoteList relay subscription) do not re-enter effects in a tight loop.
    setRelayUrlsIfChanged(finalRelays)
  }, [feedInfo.feedType, favoriteRelays, blockedRelays, extraFeedRelayUrls, setRelayUrlsIfChanged])

  return (
    <FeedContext.Provider
      value={{
        feedInfo,
        relayUrls,
        isReady,
        switchFeed
      }}
    >
      {children}
    </FeedContext.Provider>
  )
}
