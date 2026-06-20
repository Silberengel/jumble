import {
  buildLibraryRelayUrls,
  peekLibrarySearchResults,
  searchLibraryPublications,
  searchLibraryPublicationsOnRelays,
  searchLibraryPublicationsViaDocumentRelays,
  type LibraryPublicationEntry,
  type LibraryPublicationRelaySearchAxis
} from '@/lib/library-publication-index'
import { getTopLevelIndexEvents } from '@/lib/publication-index'
import logger from '@/lib/logger'
import type { Event } from 'nostr-tools'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RELAY_SEARCH_TIMEOUT_MS, SEARCH_DEBOUNCE_MS } from './config'
import { EMPTY_ENGAGEMENT } from './constants'

export function useLibrarySearch(params: {
  pubkey: string | null | undefined
  blockedRelays: readonly string[]
  indexEvents: Event[]
  settledIndexCount: number
  setIndexEvents: (events: Event[]) => void
  setAllIndexCount: (n: number) => void
  setTopLevelCount: (n: number) => void
  setFeedPageIndex: (n: number | ((p: number) => number)) => void
  setError: (msg: string | null) => void
  showOnlyMine: boolean
}) {
  const { t } = useTranslation()
  const {
    pubkey,
    blockedRelays,
    indexEvents,
    settledIndexCount,
    setIndexEvents,
    setAllIndexCount,
    setTopLevelCount,
    setFeedPageIndex,
    setError,
    showOnlyMine
  } = params

  const [searchQuery, setSearchQuery] = useState('')
  const [committedSearch, setCommittedSearch] = useState('')
  const [searchAxis, setSearchAxis] = useState<LibraryPublicationRelaySearchAxis | null>(null)
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [relaySearchLoading, setRelaySearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<LibraryPublicationEntry[] | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(committedSearch), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [committedSearch])

  useEffect(() => {
    if (!searchQuery.trim()) {
      setCommittedSearch('')
      setSearchAxis(null)
    }
  }, [searchQuery])

  useEffect(() => {
    setFeedPageIndex(0)
  }, [debouncedSearch, showOnlyMine, searchAxis, setFeedPageIndex])

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
    const q = debouncedSearch.trim()
    if (!q) {
      setSearchResults(null)
      setSearchLoading(false)
      return
    }

    if (settledIndexCount === 0 && indexEvents.length === 0) {
      setSearchLoading(true)
      return
    }

    const cached = peekLibrarySearchResults(q, { indexEvents, engagement: EMPTY_ENGAGEMENT }, searchAxis)
    if (cached) {
      setSearchResults(cached)
      setSearchLoading(false)
      return
    }

    let cancelled = false
    setSearchLoading(true)
    void (async () => {
      const applyProgress = (entries: LibraryPublicationEntry[], mergedIndexEvents?: Event[]) => {
        if (cancelled) return
        setSearchResults(entries)
        if (mergedIndexEvents) {
          setIndexEvents(mergedIndexEvents)
          setAllIndexCount(mergedIndexEvents.length)
          setTopLevelCount(getTopLevelIndexEvents(mergedIndexEvents).length)
        }
      }

      let results = await searchLibraryPublications(
        q,
        { indexEvents, engagement: EMPTY_ENGAGEMENT },
        searchAxis,
        {
          onProgress: ({ entries, mergedIndexEvents }) => applyProgress(entries, mergedIndexEvents)
        }
      )

      if (
        !cancelled &&
        results.length === 0 &&
        searchAxis &&
        (searchAxis === 'd-tag' || searchAxis === 'title' || searchAxis === 'author')
      ) {
        const doc = await searchLibraryPublicationsViaDocumentRelays(
          q,
          { indexEvents, engagement: EMPTY_ENGAGEMENT },
          searchAxis,
          blockedRelays ?? [],
          {
            onProgress: ({ entries, mergedIndexEvents }) =>
              applyProgress(entries, mergedIndexEvents)
          }
        )
        if (doc.entries.length > 0) {
          results = doc.entries
        }
      }
      if (cancelled) return
      setSearchResults(results)
      setSearchLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [
    debouncedSearch,
    settledIndexCount,
    searchAxis,
    blockedRelays,
    indexEvents,
    setIndexEvents,
    setAllIndexCount,
    setTopLevelCount
  ])

  const searchOnRelays = useCallback(async () => {
    const q = searchQuery.trim()
    if (!q) return
    setCommittedSearch(q)
    setRelaySearchLoading(true)
    setError(null)

    const applyRelayProgress = (progress: {
      entries: LibraryPublicationEntry[]
      mergedIndexEvents?: Event[]
    }) => {
      setSearchResults(progress.entries)
      if (progress.mergedIndexEvents) {
        setIndexEvents(progress.mergedIndexEvents)
        setAllIndexCount(progress.mergedIndexEvents.length)
        setTopLevelCount(getTopLevelIndexEvents(progress.mergedIndexEvents).length)
      }
    }

    try {
      const relays = await buildLibraryRelayUrls(pubkey || undefined, blockedRelays ?? [])

      let timeoutId: number | undefined
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new Error('Relay search timed out')),
          RELAY_SEARCH_TIMEOUT_MS
        )
      })
      let events: Event[]
      let fromCache: boolean
      try {
        ;({ events, fromCache } = await Promise.race([
          searchLibraryPublicationsOnRelays(q, relays, { indexEvents, engagement: EMPTY_ENGAGEMENT }, {
            axis: searchAxis,
            blockedRelays: blockedRelays ?? [],
            forceRefresh: true,
            onProgress: applyRelayProgress
          }),
          timeoutPromise
        ]))
      } finally {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId)
      }
      if (import.meta.env.DEV) {
        logger.info('[Library] relay search merged', {
          newEvents: events.length,
          fromCache
        })
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Relay search failed'
      const local = await searchLibraryPublications(q, { indexEvents, engagement: EMPTY_ENGAGEMENT }, searchAxis)
      if (local.length > 0) {
        setSearchResults(local)
        setError(null)
      } else {
        setError(message === 'Relay search timed out' ? t('Library relay search timed out') : message)
      }
      if (import.meta.env.DEV) {
        logger.warn('[Library] relay search failed', { message, localFallback: local.length })
      }
    } finally {
      setRelaySearchLoading(false)
    }
  }, [searchQuery, searchAxis, pubkey, indexEvents, blockedRelays, setError, setIndexEvents, setAllIndexCount, setTopLevelCount, t])

  return {
    searchQuery,
    setSearchQuery,
    committedSearch,
    searchAxis,
    commitSearch,
    debouncedSearch,
    searchLoading,
    relaySearchLoading,
    searchResults,
    searchOnRelays
  }
}
