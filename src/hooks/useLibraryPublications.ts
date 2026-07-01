import { BOOKLIST_LABEL_UPDATED_EVENT } from '@/lib/booklist-label'
import { EMPTY_ENGAGEMENT } from '@/hooks/library-publications/constants'
import { useLibraryIndexLoader } from '@/hooks/library-publications/useLibraryIndexLoader'
import { useLibraryLabelFilter } from '@/hooks/library-publications/useLibraryLabelFilter'
import { useLibraryMineFilter } from '@/hooks/library-publications/useLibraryMineFilter'
import { useLibrarySearch } from '@/hooks/library-publications/useLibrarySearch'
import { useLibraryViewerData } from '@/hooks/library-publications/useLibraryViewerData'
import { getPubkeysFromPTags } from '@/lib/tag'
import type { LibraryPublicationFilterMode } from '@/lib/library-publication-index'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useEffect, useMemo, useState } from 'react'

export function useLibraryPublications(isActive: boolean) {
  const { pubkey, bookmarkListEvent, followListEvent } = useNostr()
  const { blockedRelays } = useFavoriteRelays()
  const [filterMode, setFilterMode] = useState<LibraryPublicationFilterMode>('none')

  const followPubkeys = useMemo(
    () => (followListEvent ? getPubkeysFromPTags(followListEvent.tags) : []),
    [followListEvent]
  )

  const {
    pinListEvent,
    myBooklistTargets,
    booklistTargetsLoading,
    loadMyBooklistTargets
  } = useLibraryViewerData(isActive)

  const {
    entries,
    feedPageIndex,
    setFeedPageIndex,
    feedTotalCount,
    indexEvents,
    setIndexEvents,
    loading,
    error,
    setError,
    allIndexCount,
    setAllIndexCount,
    topLevelCount,
    setTopLevelCount,
    settledIndexCount,
    applyDefaultFeedSlice,
    refresh,
    loadMoreFeed
  } = useLibraryIndexLoader(isActive, pubkey, blockedRelays ?? [])

  const {
    searchQuery,
    setSearchQuery,
    committedSearch,
    searchAxis,
    commitSearch,
    commitStructuredSearch,
    resetSearch,
    debouncedSearch,
    searchLoading,
    searchResults
  } = useLibrarySearch({
    pubkey,
    blockedRelays: blockedRelays ?? [],
    indexEvents,
    settledIndexCount,
    setIndexEvents,
    setAllIndexCount,
    setTopLevelCount,
    setFeedPageIndex,
    setError,
    filterMode
  })

  const { mineIndexEntries, mineFilterComputing, filterEntriesForMine } =
    useLibraryMineFilter({
      filterMode,
      pubkey,
      indexEvents,
      debouncedSearch,
      bookmarkListEvent,
      pinListEvent,
      myBooklistTargets
    })

  const {
    recommendedIndexEntries,
    rankedSearchResults,
    labelFilterComputing,
    searchLabelFetching
  } = useLibraryLabelFilter({
    filterMode,
    pubkey,
    followPubkeys,
    indexEvents,
    debouncedSearch,
    searchResults,
    blockedRelays: blockedRelays ?? []
  })

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
  }, [
    isActive,
    pubkey,
    indexEvents,
    debouncedSearch,
    loadMyBooklistTargets,
    applyDefaultFeedSlice,
    setFeedPageIndex
  ])

  useEffect(() => {
    if (debouncedSearch.trim() || filterMode !== 'none' || indexEvents.length === 0) return
    applyDefaultFeedSlice(indexEvents, EMPTY_ENGAGEMENT, feedPageIndex)
  }, [debouncedSearch, filterMode, indexEvents, feedPageIndex, applyDefaultFeedSlice])

  const defaultFeedHasMore = useMemo(() => {
    if (debouncedSearch.trim() || filterMode !== 'none') return false
    return entries.length < feedTotalCount
  }, [debouncedSearch, filterMode, entries.length, feedTotalCount])

  const filteredEntries = useMemo(() => {
    const q = debouncedSearch.trim()
    if (filterMode === 'mine' && !q) {
      return mineFilterComputing ? [] : mineIndexEntries
    }
    if (filterMode === 'recommended' && !q) {
      return labelFilterComputing ? [] : recommendedIndexEntries
    }
    if (q) {
      const searchList =
        filterMode === 'mine'
          ? filterEntriesForMine(rankedSearchResults ?? searchResults ?? [])
          : (rankedSearchResults ?? searchResults ?? [])
      return searchList
    }
    return entries
  }, [
    entries,
    filterMode,
    debouncedSearch,
    searchResults,
    rankedSearchResults,
    mineIndexEntries,
    recommendedIndexEntries,
    mineFilterComputing,
    labelFilterComputing,
    filterEntriesForMine
  ])

  return {
    entries: filteredEntries,
    searchQuery,
    setSearchQuery,
    committedSearch,
    searchAxis,
    commitSearch,
    commitStructuredSearch,
    resetSearch,
    searchActive: committedSearch.trim().length > 0,
    filterMode,
    setFilterMode,
    mineFilterLoading: mineFilterComputing || (filterMode === 'mine' && booklistTargetsLoading),
    recommendedFilterLoading: labelFilterComputing,
    searchLabelFetching,
    loading,
    searchLoading,
    error,
    allIndexCount,
    topLevelCount,
    refresh,
    hasIndexData: indexEvents.length > 0,
    loadMoreFeed,
    defaultFeedHasMore,
    feedTotalCount
  }
}
