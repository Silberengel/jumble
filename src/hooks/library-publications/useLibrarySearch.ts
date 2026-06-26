import {
  buildLibraryRelayUrls,
  peekLibrarySearchResults,
  searchLibraryPublications,
  searchLibraryPublicationsOnRelays,
  sortLibrarySearchPublications,
  type LibraryPublicationEntry,
  type LibraryPublicationRelaySearchAxis
} from '@/lib/library-publication-index'
import { eventTagAddress, getTopLevelIndexEvents } from '@/lib/publication-index'
import logger from '@/lib/logger'
import type { Event } from 'nostr-tools'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SEARCH_PROGRESS_THROTTLE_MS } from './config'
import { EMPTY_ENGAGEMENT } from './constants'

/** Stable key matching the grid: replaceable address when present, else the event id. */
function entryKey(entry: LibraryPublicationEntry): string {
  return eventTagAddress(entry.event) ?? entry.event.id
}

/**
 * Merge a streamed result into the relevance map. Local and remote (Mercury + relay) sources are
 * folded into the same keyed map so duplicates collapse and the best match for each publication wins:
 * higher content-match score first, then the newest replaceable event; engagement flags are unioned.
 */
function mergeEntryIntoMap(
  map: Map<string, LibraryPublicationEntry>,
  incoming: LibraryPublicationEntry
): void {
  const key = entryKey(incoming)
  const existing = map.get(key)
  if (!existing) {
    map.set(key, incoming)
    return
  }
  const incomingScore = incoming.contentSearchMatch?.matchScore ?? 0
  const existingScore = existing.contentSearchMatch?.matchScore ?? 0
  const useIncomingEvent =
    incomingScore > existingScore ||
    (incomingScore === existingScore && incoming.event.created_at > existing.event.created_at)
  const bestMatch = incomingScore >= existingScore ? incoming.contentSearchMatch : existing.contentSearchMatch
  map.set(key, {
    ...(useIncomingEvent ? incoming : existing),
    event: useIncomingEvent ? incoming.event : existing.event,
    hasLabel: existing.hasLabel || incoming.hasLabel,
    labelNames: existing.labelNames.length ? existing.labelNames : incoming.labelNames,
    hasBooklistLabel: existing.hasBooklistLabel || incoming.hasBooklistLabel,
    hasMyBooklistLabel: existing.hasMyBooklistLabel || incoming.hasMyBooklistLabel,
    hasMyComment: existing.hasMyComment || incoming.hasMyComment,
    hasMyHighlight: existing.hasMyHighlight || incoming.hasMyHighlight,
    hasComment: existing.hasComment || incoming.hasComment,
    hasHighlight: existing.hasHighlight || incoming.hasHighlight,
    hasBookmark: existing.hasBookmark || incoming.hasBookmark,
    hasPin: existing.hasPin || incoming.hasPin,
    engagementCount: Math.max(existing.engagementCount, incoming.engagementCount),
    contentSearchMatch: bestMatch
  })
}

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
  // Bumped on every explicit commit so re-running the same query (e.g. clicking Search again) still
  // re-triggers the search effect for a fresh remote pass.
  const [searchToken, setSearchToken] = useState(0)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<LibraryPublicationEntry[] | null>(null)
  const progressThrottleRef = useRef<number | null>(null)

  // Search is intentional now: the effect only runs in response to commitSearch (the Search button or
  // Enter), never as a side effect of typing.
  const debouncedSearch = committedSearch

  // Read the latest index without re-running the search effect when it grows mid-search (relay
  // discovery streams new index events back in via setIndexEvents).
  const indexEventsRef = useRef(indexEvents)
  indexEventsRef.current = indexEvents

  useEffect(() => {
    if (!searchQuery.trim()) {
      setCommittedSearch('')
      setSearchAxis(null)
      setError(null)
    }
  }, [searchQuery, setError])

  useEffect(() => {
    setFeedPageIndex(0)
  }, [committedSearch, showOnlyMine, searchAxis, setFeedPageIndex])

  const commitSearch = useCallback(
    (query: string, axis: LibraryPublicationRelaySearchAxis | null) => {
      const trimmed = query.trim()
      if (!trimmed) return
      setSearchQuery(trimmed)
      setCommittedSearch(trimmed)
      setSearchAxis(axis)
      setSearchToken((token) => token + 1)
    },
    []
  )

  useEffect(() => {
    const q = committedSearch.trim()
    if (!q) {
      setSearchResults(null)
      setSearchLoading(false)
      setError(null)
      return
    }

    // Wait for the local index to settle before searching so the first pass has data to match.
    if (settledIndexCount === 0 && indexEventsRef.current.length === 0) {
      setSearchLoading(true)
      return
    }

    let cancelled = false
    const resultMap = new Map<string, LibraryPublicationEntry>()
    setSearchLoading(true)
    setError(null)
    if (progressThrottleRef.current !== null) {
      window.clearTimeout(progressThrottleRef.current)
      progressThrottleRef.current = null
    }

    const flush = () => {
      if (cancelled) return
      setSearchResults(sortLibrarySearchPublications([...resultMap.values()]))
    }

    const scheduleFlush = () => {
      if (cancelled || progressThrottleRef.current !== null) return
      flush()
      progressThrottleRef.current = window.setTimeout(() => {
        progressThrottleRef.current = null
        flush()
      }, SEARCH_PROGRESS_THROTTLE_MS)
    }

    const applyMergedIndex = (mergedIndexEvents?: Event[]) => {
      if (cancelled || !mergedIndexEvents) return
      setIndexEvents(mergedIndexEvents)
      setAllIndexCount(mergedIndexEvents.length)
      setTopLevelCount(getTopLevelIndexEvents(mergedIndexEvents).length)
    }

    const mergeEntries = (entries: LibraryPublicationEntry[], mergedIndexEvents?: Event[]) => {
      if (cancelled) return
      for (const entry of entries) mergeEntryIntoMap(resultMap, entry)
      applyMergedIndex(mergedIndexEvents)
      scheduleFlush()
    }

    // Instant: render any session-cached results synchronously before the async passes run.
    const cached = peekLibrarySearchResults(
      q,
      { indexEvents: indexEventsRef.current, engagement: EMPTY_ENGAGEMENT },
      searchAxis
    )
    if (cached) {
      for (const entry of cached) mergeEntryIntoMap(resultMap, entry)
      flush()
    }

    void (async () => {
      // 1) Local search first — render local results immediately.
      try {
        const local = await searchLibraryPublications(
          q,
          { indexEvents: indexEventsRef.current, engagement: EMPTY_ENGAGEMENT },
          searchAxis,
          { onProgress: ({ entries, mergedIndexEvents }) => mergeEntries(entries, mergedIndexEvents) }
        )
        mergeEntries(local)
      } catch (e) {
        if (import.meta.env.DEV) {
          logger.warn('[Library] local search failed', {
            message: e instanceof Error ? e.message : String(e)
          })
        }
      }
      if (cancelled) return

      // 2) Mercury API + remote relay search in parallel — both stream into the same merge map as
      // their results arrive (the orchestrator runs HTTP index relays and WS relays concurrently).
      try {
        const relays = await buildLibraryRelayUrls(pubkey || undefined, blockedRelays ?? [])
        await searchLibraryPublicationsOnRelays(
          q,
          relays,
          { indexEvents: indexEventsRef.current, engagement: EMPTY_ENGAGEMENT },
          {
            axis: searchAxis,
            blockedRelays: blockedRelays ?? [],
            onProgress: ({ entries, mergedIndexEvents }) => mergeEntries(entries, mergedIndexEvents)
          }
        )
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Relay search failed'
        if (import.meta.env.DEV) {
          logger.warn('[Library] relay search failed', { message })
        }
        // Keep whatever local/partial results we have; only surface an error if nothing matched.
        if (!cancelled && resultMap.size === 0) {
          setError(message.includes('timed out') ? t('Library relay search timed out') : message)
        }
      }
      if (cancelled) return
      flush()
      setSearchLoading(false)
    })()

    return () => {
      cancelled = true
      if (progressThrottleRef.current !== null) {
        window.clearTimeout(progressThrottleRef.current)
        progressThrottleRef.current = null
      }
    }
  }, [
    committedSearch,
    searchAxis,
    searchToken,
    settledIndexCount,
    pubkey,
    blockedRelays,
    setError,
    setIndexEvents,
    setAllIndexCount,
    setTopLevelCount,
    t
  ])

  return {
    searchQuery,
    setSearchQuery,
    committedSearch,
    searchAxis,
    commitSearch,
    debouncedSearch,
    searchLoading,
    searchResults
  }
}
