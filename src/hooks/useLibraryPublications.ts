import {
  clearAllLibraryIndexCaches,
  filterLibraryPublicationsByUser,
  buildLibraryRelayUrls,
  libraryPublicationEntriesForUserFromIndexAsync,
  libraryDefaultFeedSlice,
  loadLibraryPublicationIndex,
  peekLibrarySearchResults,
  searchLibraryPublications,
  searchLibraryPublicationsOnRelays,
  searchLibraryPublicationsViaDocumentRelays,
  type LibraryPublicationEntry,
  type LibraryPublicationRelaySearchAxis,
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
import { useTranslation } from 'react-i18next'

const SEARCH_DEBOUNCE_MS = 300
const RELAY_SEARCH_TIMEOUT_MS = 30_000

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
  commentEventIds: new Set(),
  highlightAddresses: new Set(),
  highlightEventIds: new Set(),
  bookmarkAddresses: new Set(),
  bookmarkEventIds: new Set(),
  pinAddresses: new Set(),
  pinEventIds: new Set()
}

const EMPTY_BOOKLIST_TARGETS = { addresses: new Set<string>(), eventIds: new Set<string>() }

export function useLibraryPublications(isActive: boolean) {
  const { t } = useTranslation()
  const { pubkey, bookmarkListEvent } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const [entries, setEntries] = useState<LibraryPublicationEntry[]>([])
  const [feedPageIndex, setFeedPageIndex] = useState(0)
  const [feedTotalCount, setFeedTotalCount] = useState(0)
  const [indexEvents, setIndexEvents] = useState<Event[]>([])
  const engagement = EMPTY_ENGAGEMENT
  const [searchQuery, setSearchQuery] = useState('')
  const [committedSearch, setCommittedSearch] = useState('')
  const [searchAxis, setSearchAxis] = useState<LibraryPublicationRelaySearchAxis | null>(null)
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [showOnlyMine, setShowOnlyMine] = useState(false)
  const [loading, setLoading] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [relaySearchLoading, setRelaySearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<LibraryPublicationEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [allIndexCount, setAllIndexCount] = useState(0)
  const [topLevelCount, setTopLevelCount] = useState(0)
  const [pinListEvent, setPinListEvent] = useState<Event | null>(null)
  const [myBooklistTargets, setMyBooklistTargets] = useState(EMPTY_BOOKLIST_TARGETS)
  const [booklistTargetsLoading, setBooklistTargetsLoading] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)
  const forceRefreshNextLoadRef = useRef(false)
  const indexesReadyRef = useRef(false)
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
    const t = window.setTimeout(() => setDebouncedSearch(committedSearch), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [committedSearch])

  useEffect(() => {
    if (!searchQuery.trim()) {
      setCommittedSearch('')
      setSearchAxis(null)
    }
  }, [searchQuery])

  const commitSearch = useCallback(
    (query: string, axis: LibraryPublicationRelaySearchAxis | null) => {
      const trimmed = query.trim()
      if (!trimmed) return
      setSearchQuery(trimmed)
      setCommittedSearch(trimmed)
      setSearchAxis(axis)
    },
    []
  )

  useEffect(() => {
    setFeedPageIndex(0)
  }, [debouncedSearch, showOnlyMine, searchAxis])

  const applyDefaultFeedSlice = useCallback(
    (indexEventsSlice: Event[], engagementMaps: PublicationEngagementMaps, pageIndex: number) => {
      const slice = libraryDefaultFeedSlice(indexEventsSlice, engagementMaps, pageIndex)
      setEntries(slice.entries)
      setFeedTotalCount(slice.totalCount)
      return slice
    },
    []
  )

  const applyIndexesSnapshot = useCallback(
    (
      snapshot: {
        indexEvents: Event[]
        allIndexCount: number
        topLevelCount: number
      },
      engagementMaps: PublicationEngagementMaps,
      pageIndex: number
    ) => {
      setIndexEvents(snapshot.indexEvents)
      setAllIndexCount(snapshot.allIndexCount)
      setTopLevelCount(snapshot.topLevelCount)
      applyDefaultFeedSlice(snapshot.indexEvents, engagementMaps, pageIndex)
    },
    [applyDefaultFeedSlice]
  )

  useEffect(() => {
    if (!isActive) return
    let cancelled = false
    indexesReadyRef.current = false
    setLoading(true)
    setError(null)
    setFeedPageIndex(0)
    const forceRefresh = forceRefreshNextLoadRef.current
    forceRefreshNextLoadRef.current = false
    if (import.meta.env.DEV) {
      logger.info('[Library] page load requested', { forceRefresh, reloadNonce })
    }

    void (async () => {
      try {
        const relays = await buildLibraryRelayUrls(pubkey || undefined, blockedRelays ?? [])
        if (cancelled) return
        const result = await loadLibraryPublicationIndex(relays, {
          forceRefresh,
          viewerPubkey: pubkey || undefined,
          onIndexesReady: (snapshot) => {
            if (cancelled) return
            indexesReadyRef.current = true
            if (import.meta.env.DEV && snapshot.indexEvents.length > 0) {
              logger.info('[Library] indexes ready (progress)', {
                validCount: snapshot.indexEvents.length,
                topLevelCount: snapshot.topLevelCount,
                entryCount: snapshot.engaged.length
              })
            }
            applyIndexesSnapshot(snapshot, EMPTY_ENGAGEMENT, 0)
            setLoading(false)
          }
        })
        if (cancelled) return
        applyIndexesSnapshot(
          {
            indexEvents: result.indexEvents,
            allIndexCount: result.allIndexCount,
            topLevelCount: result.topLevelCount
          },
          EMPTY_ENGAGEMENT,
          0
        )
      } catch (e) {
        if (cancelled) return
        if (!indexesReadyRef.current) {
          const message = e instanceof Error ? e.message : 'Failed to load library'
          setError(message)
          if (import.meta.env.DEV) {
            logger.warn('[Library] page load failed', { message })
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isActive, pubkey, blockedRelays, reloadNonce, applyIndexesSnapshot])

  const refresh = useCallback(() => {
    forceRefreshNextLoadRef.current = true
    void clearAllLibraryIndexCaches().then(() => setReloadNonce((n) => n + 1))
  }, [])

  useEffect(() => {
    if (!isActive || !pubkey || indexEvents.length === 0) return
    let cancelled = false
    const onBooklistUpdated = () => {
      void (async () => {
        await loadMyBooklistTargets()
        if (cancelled) return
        if (!debouncedSearch.trim()) {
          setFeedPageIndex(0)
          applyDefaultFeedSlice(indexEvents, EMPTY_ENGAGEMENT, 0)
        }
      })()
    }
    window.addEventListener(BOOKLIST_LABEL_UPDATED_EVENT, onBooklistUpdated)
    return () => {
      cancelled = true
      window.removeEventListener(BOOKLIST_LABEL_UPDATED_EVENT, onBooklistUpdated)
    }
  }, [isActive, pubkey, indexEvents, debouncedSearch, loadMyBooklistTargets, applyDefaultFeedSlice])

  useEffect(() => {
    const q = debouncedSearch.trim()
    if (!q) {
      setSearchResults(null)
      setSearchLoading(false)
      return
    }

    const cached = peekLibrarySearchResults(q, { indexEvents, engagement }, searchAxis)
    if (cached) {
      setSearchResults(cached)
      setSearchLoading(false)
      return
    }

    let cancelled = false
    setSearchLoading(true)
    void (async () => {
      let results = await searchLibraryPublications(q, { indexEvents, engagement }, searchAxis)
      if (
        !cancelled &&
        results.length === 0 &&
        searchAxis &&
        (searchAxis === 'd-tag' || searchAxis === 'title' || searchAxis === 'author')
      ) {
        const doc = await searchLibraryPublicationsViaDocumentRelays(
          q,
          { indexEvents, engagement },
          searchAxis,
          blockedRelays ?? []
        )
        if (doc.entries.length > 0) {
          results = doc.entries
          setIndexEvents(doc.mergedIndexEvents)
          setAllIndexCount(doc.mergedIndexEvents.length)
          setTopLevelCount(getTopLevelIndexEvents(doc.mergedIndexEvents).length)
        }
      }
      if (cancelled) return
      setSearchResults(results)
      setSearchLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [debouncedSearch, indexEvents, engagement, searchAxis, blockedRelays])

  const searchOnRelays = useCallback(async () => {
    const q = searchQuery.trim()
    if (!q) return
    setCommittedSearch(q)
    setRelaySearchLoading(true)
    setError(null)
    try {
      const relays = await buildLibraryRelayUrls(pubkey || undefined, blockedRelays ?? [])

      if (searchAxis) {
        const doc = await searchLibraryPublicationsViaDocumentRelays(
          q,
          { indexEvents, engagement },
          searchAxis,
          blockedRelays ?? []
        )
        if (doc.entries.length > 0) {
          setIndexEvents(doc.mergedIndexEvents)
          setAllIndexCount(doc.mergedIndexEvents.length)
          setTopLevelCount(getTopLevelIndexEvents(doc.mergedIndexEvents).length)
          setSearchResults(doc.entries)
          if (import.meta.env.DEV) {
            logger.info('[Library] relay search satisfied by document relays', {
              query: q,
              axis: searchAxis,
              count: doc.entries.length
            })
          }
          return
        }
      }

      let timeoutId: number | undefined
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new Error('Relay search timed out')),
          RELAY_SEARCH_TIMEOUT_MS
        )
      })
      let events: Event[]
      let mergedIndexEvents: Event[]
      let fromCache: boolean
      try {
        ;({ events, mergedIndexEvents, fromCache } = await Promise.race([
          searchLibraryPublicationsOnRelays(
            q,
            relays,
            { indexEvents, engagement },
            { axis: searchAxis, blockedRelays: blockedRelays ?? [], forceRefresh: true }
          ),
          timeoutPromise
        ]))
      } finally {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId)
      }
      setIndexEvents(mergedIndexEvents)
      setAllIndexCount(mergedIndexEvents.length)
      setTopLevelCount(getTopLevelIndexEvents(mergedIndexEvents).length)
      if (import.meta.env.DEV) {
        logger.info('[Library] relay search merged', {
          newEvents: events.length,
          fromCache
        })
      }

      const entries = await searchLibraryPublications(q, {
        indexEvents: mergedIndexEvents,
        engagement: EMPTY_ENGAGEMENT
      }, searchAxis)
      setSearchResults(entries)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Relay search failed'
      const local = await searchLibraryPublications(q, { indexEvents, engagement }, searchAxis)
      if (local.length > 0) {
        setSearchResults(local)
        setError(null)
      } else {
        setError(
          message === 'Relay search timed out' ? t('Library relay search timed out') : message
        )
      }
      if (import.meta.env.DEV) {
        logger.warn('[Library] relay search failed', { message, localFallback: local.length })
      }
    } finally {
      setRelaySearchLoading(false)
    }
  }, [searchQuery, searchAxis, pubkey, indexEvents, engagement, blockedRelays, t])

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

  useEffect(() => {
    if (debouncedSearch.trim() || showOnlyMine || indexEvents.length === 0) return
    applyDefaultFeedSlice(indexEvents, engagement, feedPageIndex)
  }, [debouncedSearch, showOnlyMine, indexEvents, engagement, feedPageIndex, applyDefaultFeedSlice])

  const loadMoreFeed = useCallback(() => {
    setFeedPageIndex((page) => page + 1)
  }, [])

  const defaultFeedHasMore = useMemo(() => {
    if (debouncedSearch.trim() || showOnlyMine) return false
    return entries.length < feedTotalCount
  }, [debouncedSearch, showOnlyMine, entries.length, feedTotalCount])

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
    committedSearch,
    searchAxis,
    commitSearch,
    showOnlyMine,
    setShowOnlyMine,
    mineFilterLoading:
      mineFilterComputing || (showOnlyMine && booklistTargetsLoading),
    loading,
    searchLoading,
    relaySearchLoading,
    error,
    allIndexCount,
    topLevelCount,
    refresh,
    searchOnRelays,
    hasIndexData: indexEvents.length > 0,
    loadMoreFeed,
    defaultFeedHasMore,
    feedTotalCount
  }
}
