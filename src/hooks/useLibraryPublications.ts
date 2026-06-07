import {
  clearAllLibraryIndexCaches,
  filterLibraryPublicationsByUser,
  buildLibraryRelayUrls,
  libraryPublicationEntriesForUserFromIndexAsync,
  loadLibraryPublicationIndex,
  peekLibrarySearchResults,
  refreshLibraryEngagement,
  searchLibraryPublications,
  searchLibraryPublicationsOnRelays,
  type LibraryPublicationEntry,
  type PublicationEngagementMaps,
  type LibraryMineFilterOpts
} from '@/lib/library-publication-index'
import { BOOKLIST_LABEL_UPDATED_EVENT, fetchViewerBooklistTargets } from '@/lib/booklist-label'
import { buildAccountListRelayUrlsForMerge } from '@/lib/account-list-relay-urls'
import { fetchNewestPinListForPubkey } from '@/lib/replaceable-list-latest'
import { getTopLevelIndexEvents } from '@/lib/publication-index'
import logger from '@/lib/logger'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'
import type { Event } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const SEARCH_DEBOUNCE_MS = 300
const LOAD_TIMEOUT_MS = 120_000

const EMPTY_ENGAGEMENT: PublicationEngagementMaps = {
  labelAddresses: new Set(),
  labelEventIds: new Set(),
  labelValuesByAddress: new Map(),
  labelValuesByEventId: new Map(),
  booklistAddresses: new Set(),
  booklistEventIds: new Set(),
  myBooklistAddresses: new Set(),
  myBooklistEventIds: new Set(),
  myCommentAddresses: new Set(),
  myCommentEventIds: new Set(),
  myHighlightAddresses: new Set(),
  myHighlightEventIds: new Set(),
  commentAddresses: new Set(),
  highlightAddresses: new Set()
}

const EMPTY_BOOKLIST_TARGETS = { addresses: new Set<string>(), eventIds: new Set<string>() }

export function useLibraryPublications(isActive: boolean) {
  const { pubkey, bookmarkListEvent } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const [entries, setEntries] = useState<LibraryPublicationEntry[]>([])
  const [indexEvents, setIndexEvents] = useState<Event[]>([])
  const [engagement, setEngagement] = useState<PublicationEngagementMaps>(EMPTY_ENGAGEMENT)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [showOnlyMine, setShowOnlyMine] = useState(false)
  const [loading, setLoading] = useState(false)
  const [engagementLoading, setEngagementLoading] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [relaySearchLoading, setRelaySearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<LibraryPublicationEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [allIndexCount, setAllIndexCount] = useState(0)
  const [topLevelCount, setTopLevelCount] = useState(0)
  const [pinListEvent, setPinListEvent] = useState<Event | null>(null)
  const [myBooklistTargets, setMyBooklistTargets] = useState(EMPTY_BOOKLIST_TARGETS)
  const [booklistTargetsLoading, setBooklistTargetsLoading] = useState(false)
  const loadGenRef = useRef(0)
  const [mineIndexEntries, setMineIndexEntries] = useState<LibraryPublicationEntry[]>([])
  const [mineFilterComputing, setMineFilterComputing] = useState(false)
  const mineIndexCacheRef = useRef<{
    indexEvents: Event[]
    engagement: PublicationEngagementMaps
    pubkey: string
    mineFilterOpts: LibraryMineFilterOpts
    entries: LibraryPublicationEntry[]
  } | null>(null)

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
    if (!isActive || !pubkey) {
      setMyBooklistTargets(EMPTY_BOOKLIST_TARGETS)
      return
    }
    void loadMyBooklistTargets()
  }, [isActive, pubkey, loadMyBooklistTargets])

  useEffect(() => {
    if (!pubkey) {
      setPinListEvent(null)
      return
    }
    let cancelled = false
    void (async () => {
      const relays = await buildLibraryRelayUrls(pubkey, blockedRelays ?? [])
      const pinList = await fetchNewestPinListForPubkey(pubkey, relays)
      if (!cancelled) setPinListEvent(pinList ?? null)
    })()
    return () => {
      cancelled = true
    }
  }, [pubkey])

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchQuery), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [searchQuery])

  const load = useCallback(
    async (forceRefresh = false) => {
      const gen = ++loadGenRef.current
      setLoading(true)
      setEngagementLoading(false)
      setError(null)
      if (import.meta.env.DEV) {
        logger.info('[Library] page load requested', { forceRefresh, gen })
      }
      try {
        const relays = await buildLibraryRelayUrls(pubkey || undefined, blockedRelays ?? [])
        let timeoutId: number | undefined
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(() => reject(new Error('Library load timed out')), LOAD_TIMEOUT_MS)
        })
        try {
          const result = await Promise.race([
            loadLibraryPublicationIndex(relays, {
              forceRefresh,
              viewerPubkey: pubkey || undefined,
              onIndexesReady: (snapshot) => {
                if (gen !== loadGenRef.current) return
                setEntries(snapshot.engaged)
                setIndexEvents(snapshot.indexEvents)
                setAllIndexCount(snapshot.allIndexCount)
                setTopLevelCount(snapshot.topLevelCount)
                setLoading(false)
                setEngagementLoading(true)
              }
            }),
            timeoutPromise
          ])
          if (gen !== loadGenRef.current) return
          setEntries(result.engaged)
          setIndexEvents(result.indexEvents)
          setEngagement(result.engagement)
          setAllIndexCount(result.allIndexCount)
          setTopLevelCount(result.topLevelCount)
        } finally {
          if (timeoutId != null) window.clearTimeout(timeoutId)
        }
      } catch (e) {
        if (gen !== loadGenRef.current) return
        const message = e instanceof Error ? e.message : 'Failed to load library'
        setError(message)
        if (import.meta.env.DEV) {
          logger.warn('[Library] page load failed', { message, gen })
        }
      } finally {
        if (gen === loadGenRef.current) {
          setLoading(false)
          setEngagementLoading(false)
        }
      }
    },
    [pubkey, blockedRelays]
  )

  useEffect(() => {
    if (!isActive) return
    void load(false)
  }, [isActive, load])

  useEffect(() => {
    if (!isActive || !pubkey || indexEvents.length === 0) return
    let cancelled = false
    const onBooklistUpdated = () => {
      void (async () => {
        await loadMyBooklistTargets()
        const relays = await buildLibraryRelayUrls(pubkey, blockedRelays ?? [])
        const { engagement: nextEngagement, engaged } = await refreshLibraryEngagement(
          relays,
          indexEvents,
          pubkey
        )
        if (cancelled) return
        setEngagement(nextEngagement)
        if (!debouncedSearch.trim()) {
          setEntries(engaged)
        }
      })()
    }
    window.addEventListener(BOOKLIST_LABEL_UPDATED_EVENT, onBooklistUpdated)
    return () => {
      cancelled = true
      window.removeEventListener(BOOKLIST_LABEL_UPDATED_EVENT, onBooklistUpdated)
    }
  }, [isActive, pubkey, indexEvents, debouncedSearch, loadMyBooklistTargets, blockedRelays])

  useEffect(() => {
    const q = debouncedSearch.trim()
    if (!q) {
      setSearchResults(null)
      setSearchLoading(false)
      return
    }

    const cached = peekLibrarySearchResults(q, { indexEvents, engagement })
    if (cached) {
      setSearchResults(cached)
      setSearchLoading(false)
      return
    }

    let cancelled = false
    setSearchLoading(true)
    void searchLibraryPublications(q, { indexEvents, engagement }).then((results) => {
      if (cancelled) return
      setSearchResults(results)
      setSearchLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [debouncedSearch, indexEvents, engagement])

  const refresh = useCallback(() => {
    void clearAllLibraryIndexCaches().then(() => load(true))
  }, [load])

  const searchOnRelays = useCallback(async () => {
    const q = searchQuery.trim()
    if (!q) return
    setRelaySearchLoading(true)
    setError(null)
    try {
      const relays = await buildLibraryRelayUrls(pubkey || undefined, blockedRelays ?? [])
      const { events, mergedIndexEvents, fromCache } = await searchLibraryPublicationsOnRelays(
        q,
        relays,
        { indexEvents, engagement }
      )
      setIndexEvents(mergedIndexEvents)
      setAllIndexCount(mergedIndexEvents.length)
      setTopLevelCount(getTopLevelIndexEvents(mergedIndexEvents).length)
      if (import.meta.env.DEV) {
        logger.info('[Library] relay search merged', {
          newEvents: events.length,
          fromCache
        })
      }

      let nextEngagement = engagement
      if (pubkey) {
        const refreshed = await refreshLibraryEngagement(relays, mergedIndexEvents, pubkey)
        nextEngagement = refreshed.engagement
        setEngagement(nextEngagement)
      }

      const entries = await searchLibraryPublications(q, {
        indexEvents: mergedIndexEvents,
        engagement: nextEngagement
      })
      setSearchResults(entries)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Relay search failed'
      setError(message)
      if (import.meta.env.DEV) {
        logger.warn('[Library] relay search failed', { message })
      }
    } finally {
      setRelaySearchLoading(false)
    }
  }, [searchQuery, pubkey, indexEvents, engagement, blockedRelays])

  const mineFilterOpts = useMemo(
    () => ({
      bookmarkListEvent,
      pinListEvent,
      myBooklistAddresses: myBooklistTargets.addresses,
      myBooklistEventIds: myBooklistTargets.eventIds
    }),
    [bookmarkListEvent, pinListEvent, myBooklistTargets]
  )

  useEffect(() => {
    if (!showOnlyMine || !pubkey || indexEvents.length === 0 || debouncedSearch.trim()) {
      setMineFilterComputing(false)
      return
    }

    const cached = mineIndexCacheRef.current
    if (
      cached &&
      cached.indexEvents === indexEvents &&
      cached.engagement === engagement &&
      cached.pubkey === pubkey &&
      cached.mineFilterOpts === mineFilterOpts
    ) {
      setMineIndexEntries(cached.entries)
      setMineFilterComputing(false)
      return
    }

    const signal = { cancelled: false }
    setMineFilterComputing(true)

    void libraryPublicationEntriesForUserFromIndexAsync(
      indexEvents,
      engagement,
      pubkey,
      mineFilterOpts,
      signal
    ).then((computed) => {
      if (signal.cancelled) return
      mineIndexCacheRef.current = {
        indexEvents,
        engagement,
        pubkey,
        mineFilterOpts,
        entries: computed
      }
      setMineIndexEntries(computed)
      setMineFilterComputing(false)
    })

    return () => {
      signal.cancelled = true
    }
  }, [showOnlyMine, pubkey, indexEvents, engagement, mineFilterOpts, debouncedSearch])

  const filteredEntries = useMemo(() => {
    const q = debouncedSearch.trim()
    let list: LibraryPublicationEntry[]
    if (showOnlyMine && !q) {
      list = mineFilterComputing ? [] : mineIndexEntries
    } else {
      list = q ? (searchResults ?? []) : entries
      if (showOnlyMine) {
        list = filterLibraryPublicationsByUser(list, pubkey, mineFilterOpts)
      }
    }
    return list
  }, [
    entries,
    showOnlyMine,
    pubkey,
    debouncedSearch,
    searchResults,
    mineIndexEntries,
    mineFilterComputing,
    mineFilterOpts
  ])

  return {
    entries: filteredEntries,
    searchQuery,
    setSearchQuery,
    showOnlyMine,
    setShowOnlyMine,
    mineFilterLoading:
      mineFilterComputing || (showOnlyMine && booklistTargetsLoading),
    loading,
    engagementLoading,
    searchLoading,
    relaySearchLoading,
    error,
    allIndexCount,
    topLevelCount,
    refresh,
    searchOnRelays,
    hasIndexData: indexEvents.length > 0
  }
}
