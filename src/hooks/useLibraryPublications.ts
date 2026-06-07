import {
  clearLibraryPublicationIndexCache,
  filterLibraryPublicationsBySearch,
  filterLibraryPublicationsByUser,
  buildLibraryRelayUrls,
  loadLibraryPublicationIndex,
  type LibraryPublicationEntry
} from '@/lib/library-publication-index'
import { useNostr } from '@/providers/NostrProvider'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const SEARCH_DEBOUNCE_MS = 300

export function useLibraryPublications(isActive: boolean) {
  const { pubkey } = useNostr()
  const [entries, setEntries] = useState<LibraryPublicationEntry[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [showOnlyMine, setShowOnlyMine] = useState(false)
  const [loading, setLoading] = useState(false)
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
      setError(null)
      try {
        const relays = await buildLibraryRelayUrls(pubkey || undefined)
        const result = await loadLibraryPublicationIndex(relays, { forceRefresh })
        if (gen !== loadGenRef.current) return
        setEntries(result.engaged)
        setAllIndexCount(result.allIndexCount)
        setTopLevelCount(result.topLevelCount)
      } catch (e) {
        if (gen !== loadGenRef.current) return
        setError(e instanceof Error ? e.message : 'Failed to load library')
      } finally {
        if (gen === loadGenRef.current) setLoading(false)
      }
    },
    [pubkey]
  )

  useEffect(() => {
    if (!isActive) return
    void load(false)
  }, [isActive, load])

  const refresh = useCallback(() => {
    clearLibraryPublicationIndexCache()
    void load(true)
  }, [load])

  const filteredEntries = useMemo(() => {
    let list = entries
    if (showOnlyMine) {
      list = filterLibraryPublicationsByUser(list, pubkey)
    }
    if (debouncedSearch.trim()) {
      list = filterLibraryPublicationsBySearch(list, debouncedSearch)
    }
    return list
  }, [entries, showOnlyMine, pubkey, debouncedSearch])

  return {
    entries: filteredEntries,
    searchQuery,
    setSearchQuery,
    showOnlyMine,
    setShowOnlyMine,
    loading,
    error,
    allIndexCount,
    topLevelCount,
    refresh
  }
}
