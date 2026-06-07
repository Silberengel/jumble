import {
  clearAllLibraryIndexCaches,
  filterLibraryPublicationsByUser,
  buildLibraryRelayUrls,
  loadLibraryPublicationIndex,
  peekLibrarySearchResults,
  searchLibraryPublications,
  searchLibraryPublicationsOnRelays,
  type LibraryPublicationEntry,
  type PublicationEngagementMaps
} from '@/lib/library-publication-index'
import { getTopLevelIndexEvents } from '@/lib/publication-index'
import logger from '@/lib/logger'
import { useNostr } from '@/providers/NostrProvider'
import type { Event } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const SEARCH_DEBOUNCE_MS = 300
const LOAD_TIMEOUT_MS = 120_000

const EMPTY_ENGAGEMENT: PublicationEngagementMaps = {
  labelAddresses: new Set(),
  labelEventIds: new Set(),
  commentAddresses: new Set(),
  highlightAddresses: new Set()
}

export function useLibraryPublications(isActive: boolean) {
  const { pubkey } = useNostr()
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
  const loadGenRef = useRef(0)

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
        const relays = await buildLibraryRelayUrls(pubkey || undefined)
        let timeoutId: number | undefined
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(() => reject(new Error('Library load timed out')), LOAD_TIMEOUT_MS)
        })
        try {
          const result = await Promise.race([
            loadLibraryPublicationIndex(relays, {
              forceRefresh,
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
    [pubkey]
  )

  useEffect(() => {
    if (!isActive) return
    void load(false)
  }, [isActive, load])

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
      const relays = await buildLibraryRelayUrls(pubkey || undefined)
      const { events, mergedIndexEvents, entries, fromCache } = await searchLibraryPublicationsOnRelays(
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
  }, [searchQuery, pubkey, indexEvents, engagement])

  const filteredEntries = useMemo(() => {
    const q = debouncedSearch.trim()
    let list = q ? (searchResults ?? []) : entries
    if (showOnlyMine) {
      list = filterLibraryPublicationsByUser(list, pubkey)
    }
    return list
  }, [entries, showOnlyMine, pubkey, debouncedSearch, searchResults])

  return {
    entries: filteredEntries,
    searchQuery,
    setSearchQuery,
    showOnlyMine,
    setShowOnlyMine,
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
