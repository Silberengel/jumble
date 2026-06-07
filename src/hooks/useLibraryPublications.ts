import {
  clearLibraryPublicationIndexCache,
  filterLibraryPublicationsBySearch,
  filterLibraryPublicationsByUser,
  buildLibraryRelayUrls,
  loadLibraryPublicationIndex,
  type LibraryPublicationEntry
} from '@/lib/library-publication-index'
import logger from '@/lib/logger'
import { useNostr } from '@/providers/NostrProvider'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const SEARCH_DEBOUNCE_MS = 300
const LOAD_TIMEOUT_MS = 90_000

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
  const inFlightRef = useRef(0)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchQuery), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [searchQuery])

  const load = useCallback(
    async (forceRefresh = false) => {
      const gen = ++loadGenRef.current
      inFlightRef.current += 1
      setLoading(true)
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
            loadLibraryPublicationIndex(relays, { forceRefresh }),
            timeoutPromise
          ])
          if (gen !== loadGenRef.current) return
          setEntries(result.engaged)
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
        inFlightRef.current = Math.max(0, inFlightRef.current - 1)
        if (inFlightRef.current === 0) {
          setLoading(false)
        }
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
