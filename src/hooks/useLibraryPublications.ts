import { BOOKLIST_LABEL_UPDATED_EVENT } from '@/lib/booklist-label'
import { EMPTY_ENGAGEMENT } from '@/hooks/library-publications/constants'
import { useLibraryIndexLoader } from '@/hooks/library-publications/useLibraryIndexLoader'
import { useLibraryMineFilter } from '@/hooks/library-publications/useLibraryMineFilter'
import { useLibrarySearch } from '@/hooks/library-publications/useLibrarySearch'
import { useLibraryViewerData } from '@/hooks/library-publications/useLibraryViewerData'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useEffect, useMemo, useState } from 'react'

export function useLibraryPublications(isActive: boolean) {
  const { pubkey, bookmarkListEvent } = useNostr()
  const { blockedRelays } = useFavoriteRelays()
  const [showOnlyMine, setShowOnlyMine] = useState(false)

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
    showOnlyMine
  })

  const { mineIndexEntries, mineFilterComputing, filterEntriesForMine } =
    useLibraryMineFilter({
      showOnlyMine,
      pubkey,
      indexEvents,
      debouncedSearch,
      bookmarkListEvent,
      pinListEvent,
      myBooklistTargets
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
    if (debouncedSearch.trim() || showOnlyMine || indexEvents.length === 0) return
    applyDefaultFeedSlice(indexEvents, EMPTY_ENGAGEMENT, feedPageIndex)
  }, [debouncedSearch, showOnlyMine, indexEvents, feedPageIndex, applyDefaultFeedSlice])

  const defaultFeedHasMore = useMemo(() => {
    if (debouncedSearch.trim() || showOnlyMine) return false
    return entries.length < feedTotalCount
  }, [debouncedSearch, showOnlyMine, entries.length, feedTotalCount])

  const filteredEntries = useMemo(() => {
    const q = debouncedSearch.trim()
    let list =
      showOnlyMine && !q ? (mineFilterComputing ? [] : mineIndexEntries) : q ? (searchResults ?? []) : entries
    if (showOnlyMine && q) {
      list = filterEntriesForMine(list)
    }
    return list
  }, [
    entries,
    showOnlyMine,
    debouncedSearch,
    searchResults,
    mineIndexEntries,
    mineFilterComputing,
    filterEntriesForMine
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
    mineFilterLoading: mineFilterComputing || (showOnlyMine && booklistTargetsLoading),
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
