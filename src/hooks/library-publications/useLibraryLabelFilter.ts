import {
  buildLibraryRelayUrls,
  fetchPublicationLabelEngagementForEntries,
  fetchRecommendedPublicationLabelEngagement,
  filterAndSortLibraryRecommendedPublications,
  libraryPublicationRecommendedEntriesFromIndexAsync,
  sortLibrarySearchPublicationsByLabelRank,
  type LibraryLabelRankContext,
  type LibraryPublicationEntry,
  type LibraryPublicationFilterMode,
  type PublicationEngagementMaps
} from '@/lib/library-publication-index'
import type { Event } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export function useLibraryLabelFilter(params: {
  filterMode: LibraryPublicationFilterMode
  pubkey: string | null | undefined
  followPubkeys: readonly string[]
  indexEvents: Event[]
  debouncedSearch: string
  searchResults: LibraryPublicationEntry[] | null
  blockedRelays: readonly string[]
}) {
  const {
    filterMode,
    pubkey,
    followPubkeys,
    indexEvents,
    debouncedSearch,
    searchResults,
    blockedRelays
  } = params

  const [recommendedIndexEntries, setRecommendedIndexEntries] = useState<LibraryPublicationEntry[]>([])
  const [rankedSearchResults, setRankedSearchResults] = useState<LibraryPublicationEntry[] | null>(null)
  const [labelFilterComputing, setLabelFilterComputing] = useState(false)
  const [searchLabelFetching, setSearchLabelFetching] = useState(false)

  const recommendedCacheRef = useRef<{
    indexEvents: Event[]
    followKey: string
    entries: LibraryPublicationEntry[]
  } | null>(null)

  const searchLabelCacheRef = useRef<{
    searchResults: LibraryPublicationEntry[]
    filterMode: LibraryPublicationFilterMode
    followKey: string
    entries: LibraryPublicationEntry[]
  } | null>(null)

  const labelRankContext = useMemo((): LibraryLabelRankContext => {
    const followSet = new Set(followPubkeys.map((pk) => pk.toLowerCase()))
    return { viewerPubkey: pubkey, followPubkeys: followSet }
  }, [pubkey, followPubkeys])

  const followKey = useMemo(
    () => [...labelRankContext.followPubkeys].sort().join(','),
    [labelRankContext.followPubkeys]
  )

  const applySearchLabelRanking = useCallback(
    (entries: LibraryPublicationEntry[], engagement: PublicationEngagementMaps) => {
      if (filterMode === 'recommended') {
        return filterAndSortLibraryRecommendedPublications(entries, indexEvents, engagement, labelRankContext)
      }
      return sortLibrarySearchPublicationsByLabelRank(entries, indexEvents, engagement, labelRankContext)
    },
    [filterMode, indexEvents, labelRankContext]
  )

  // Recommended feed (no active search): labels from follows + GC Publishing.
  useEffect(() => {
    if (filterMode !== 'recommended' || debouncedSearch.trim() || indexEvents.length === 0) {
      setRecommendedIndexEntries([])
      setLabelFilterComputing(false)
      return
    }

    const cached = recommendedCacheRef.current
    if (cached && cached.indexEvents === indexEvents && cached.followKey === followKey) {
      setRecommendedIndexEntries(cached.entries)
      setLabelFilterComputing(false)
      return
    }

    const signal = { cancelled: false }
    setLabelFilterComputing(true)

    void (async () => {
      try {
        const relays = await buildLibraryRelayUrls(pubkey || undefined, blockedRelays ?? [])
        if (signal.cancelled) return
        const engagement = await fetchRecommendedPublicationLabelEngagement(relays, {
          followPubkeys,
          viewerPubkey: pubkey
        })
        if (signal.cancelled) return
        const computed = await libraryPublicationRecommendedEntriesFromIndexAsync(
          indexEvents,
          engagement,
          labelRankContext,
          signal
        )
        if (signal.cancelled) return
        recommendedCacheRef.current = { indexEvents, followKey, entries: computed }
        setRecommendedIndexEntries(computed)
      } catch {
        if (signal.cancelled) return
        recommendedCacheRef.current = { indexEvents, followKey, entries: [] }
        setRecommendedIndexEntries([])
      } finally {
        if (!signal.cancelled) setLabelFilterComputing(false)
      }
    })()

    return () => {
      signal.cancelled = true
    }
  }, [
    filterMode,
    debouncedSearch,
    indexEvents,
    followKey,
    followPubkeys,
    pubkey,
    blockedRelays,
    labelRankContext
  ])

  // Search results: fetch labels for matched publications and rank (or filter+rank for recommended).
  useEffect(() => {
    const q = debouncedSearch.trim()
    if (!q || !searchResults) {
      setRankedSearchResults(null)
      setSearchLabelFetching(false)
      return
    }
    if (filterMode === 'mine') {
      setRankedSearchResults(searchResults)
      setSearchLabelFetching(false)
      return
    }
    if (searchResults.length === 0) {
      setRankedSearchResults(searchResults)
      setSearchLabelFetching(false)
      return
    }

    const cached = searchLabelCacheRef.current
    if (
      cached &&
      cached.searchResults === searchResults &&
      cached.filterMode === filterMode &&
      cached.followKey === followKey
    ) {
      setRankedSearchResults(cached.entries)
      setSearchLabelFetching(false)
      return
    }

    // Show relevance-ordered results immediately; re-rank once label engagement arrives.
    setRankedSearchResults(searchResults)

    let cancelled = false
    setSearchLabelFetching(true)

    void (async () => {
      try {
        const relays = await buildLibraryRelayUrls(pubkey || undefined, blockedRelays ?? [])
        if (cancelled) return
        const engagement = await fetchPublicationLabelEngagementForEntries(
          relays,
          searchResults,
          indexEvents,
          { viewerPubkey: pubkey }
        )
        if (cancelled) return
        const ranked = applySearchLabelRanking(searchResults, engagement)
        searchLabelCacheRef.current = {
          searchResults,
          filterMode,
          followKey,
          entries: ranked
        }
        setRankedSearchResults(ranked)
      } catch {
        if (cancelled) return
        setRankedSearchResults(searchResults)
      } finally {
        if (!cancelled) setSearchLabelFetching(false)
      }
    })()

    return () => {
      cancelled = true
      setSearchLabelFetching(false)
    }
  }, [
    debouncedSearch,
    searchResults,
    filterMode,
    followKey,
    indexEvents,
    pubkey,
    blockedRelays,
    applySearchLabelRanking
  ])

  return {
    recommendedIndexEntries,
    rankedSearchResults,
    labelFilterComputing,
    searchLabelFetching
  }
}
