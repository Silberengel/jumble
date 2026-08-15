import {
  buildLibraryRelayUrls,
  fetchLibraryIndexEvents,
  filterLibraryEntriesByCreatedAt,
  isLibraryStructuredTagField,
  libraryEntriesMatchingCreatedAt,
  peekLibrarySearchResults,
  searchLibraryPublications,
  searchLibraryPublicationsByStructuredTagField,
  searchLibraryPublicationsOnRelays,
  searchLibraryPublicationsOnRelaysByStructuredTagField,
  sortLibrarySearchPublications,
  structuredQueryFilledFields,
  structuredQueryHasDateBounds,
  structuredQueryToString,
  type LibraryPublicationEntry,
  type LibraryPublicationFilterMode,
  type LibraryPublicationRelaySearchAxis,
  type LibraryStructuredSearchQuery
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
  const curatorPubkeys = [
    ...new Set([...(existing.labelCuratorPubkeys ?? []), ...(incoming.labelCuratorPubkeys ?? [])])
  ]
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
    labelCuratorPubkeys: curatorPubkeys.length > 0 ? curatorPubkeys : undefined,
    contentSearchMatch: bestMatch
  })
}

/**
 * Rank structured-search results by how many of the filled fields each publication matched (soft-AND:
 * more matched fields first), falling back to the standard relevance order within an equal field count.
 */
function sortByFieldMatchCount(
  entries: LibraryPublicationEntry[],
  fieldHits: Map<string, Set<string>>
): LibraryPublicationEntry[] {
  const matchCount = (entry: LibraryPublicationEntry) => fieldHits.get(entryKey(entry))?.size ?? 0
  // sortLibrarySearchPublications gives the per-entry relevance order; Array.sort is stable, so equal
  // field counts keep that order.
  const base = sortLibrarySearchPublications(entries)
  return base.sort((a, b) => matchCount(b) - matchCount(a))
}

/**
 * Strict cross-field AND with a soft-AND fallback: when at least one publication matches every filled
 * field, return only those (true AND). Otherwise fall back to the soft-AND ranking (best partial matches
 * first) so the user still sees the closest results instead of an empty list.
 * Never surface entries that matched zero structured fields (e.g. browse bleed).
 */
function selectStructuredResults(
  entries: LibraryPublicationEntry[],
  fieldHits: Map<string, Set<string>>,
  filledFieldCount: number
): LibraryPublicationEntry[] {
  const withHits = entries.filter((entry) => (fieldHits.get(entryKey(entry))?.size ?? 0) > 0)
  const ranked = sortByFieldMatchCount(withHits, fieldHits)
  if (filledFieldCount <= 0) return ranked
  const strict = ranked.filter(
    (entry) => (fieldHits.get(entryKey(entry))?.size ?? 0) >= filledFieldCount
  )
  return strict.length > 0 ? strict : ranked
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
  filterMode: LibraryPublicationFilterMode
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
    filterMode
  } = params

  const [searchQuery, setSearchQuery] = useState('')
  const [committedSearch, setCommittedSearch] = useState('')
  const [searchAxis, setSearchAxis] = useState<LibraryPublicationRelaySearchAxis | null>(null)
  // Structured (multi-field) search. When set, it takes over from the simple single-box search.
  const [structuredSearch, setStructuredSearch] = useState<LibraryStructuredSearchQuery | null>(null)
  // Bumped on every explicit commit so re-running the same query (e.g. clicking Search again) still
  // re-triggers the search effect for a fresh remote pass.
  const [searchToken, setSearchToken] = useState(0)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<LibraryPublicationEntry[] | null>(null)
  const progressThrottleRef = useRef<number | null>(null)

  // The active search string: the structured query (flattened) when in advanced mode, else the simple
  // committed query. Search is intentional: effects only run in response to a commit (Search button or
  // Enter), never as a side effect of typing.
  const activeSearch = structuredSearch ? structuredQueryToString(structuredSearch) : committedSearch
  const debouncedSearch = activeSearch

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
  }, [activeSearch, filterMode, searchAxis, setFeedPageIndex])

  const commitSearch = useCallback(
    (query: string, axis: LibraryPublicationRelaySearchAxis | null) => {
      const trimmed = query.trim()
      if (!trimmed) return
      setStructuredSearch(null)
      setSearchQuery(trimmed)
      setCommittedSearch(trimmed)
      setSearchAxis(axis)
      setSearchToken((token) => token + 1)
    },
    []
  )

  // Thorough reset: cancels any in-flight search (clearing committed/structured state tears down the
  // search effects via their cleanup) and wipes every piece of search panel state back to its initial
  // value. Used by both the Clear button and the Search-button-as-Stop while a search is running.
  const resetSearch = useCallback(() => {
    if (progressThrottleRef.current !== null) {
      window.clearTimeout(progressThrottleRef.current)
      progressThrottleRef.current = null
    }
    setSearchQuery('')
    setCommittedSearch('')
    setSearchAxis(null)
    setStructuredSearch(null)
    setSearchResults(null)
    setSearchLoading(false)
    setError(null)
    setSearchToken((token) => token + 1)
  }, [setError])

  const commitStructuredSearch = useCallback((query: LibraryStructuredSearchQuery) => {
    const fields = structuredQueryFilledFields(query)
    if (fields.length === 0 && !structuredQueryHasDateBounds(query)) {
      setStructuredSearch(null)
      return
    }
    setCommittedSearch('')
    setSearchAxis(null)
    setStructuredSearch(query)
    setSearchToken((token) => token + 1)
  }, [])

  useEffect(() => {
    // The structured-search effect owns rendering while advanced mode is active.
    if (structuredSearch) return
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
            forceRefresh: true,
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
    structuredSearch,
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

  // Structured (multi-field) search: local-first per field (instant UI), then always Mercury + WS
  // remotes — never skip the network pass because of a local AND hit.
  // Optional since/until post-filter on created_at; date-only queries browse the local index (+ events/filter).
  useEffect(() => {
    if (!structuredSearch) return
    const fields = structuredQueryFilledFields(structuredSearch)
    const hasDates = structuredQueryHasDateBounds(structuredSearch)
    const createdAt =
      hasDates
        ? {
            since: structuredSearch.since,
            until: structuredSearch.until
          }
        : undefined

    if (fields.length === 0 && !hasDates) {
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
    // entryKey -> set of structured field names that matched the publication.
    const fieldHits = new Map<string, Set<string>>()
    setSearchLoading(true)
    setError(null)
    if (progressThrottleRef.current !== null) {
      window.clearTimeout(progressThrottleRef.current)
      progressThrottleRef.current = null
    }

    const flush = () => {
      if (cancelled) return
      const ranked =
        fields.length === 0
          ? sortLibrarySearchPublications([...resultMap.values()])
          : selectStructuredResults([...resultMap.values()], fieldHits, fields.length)
      setSearchResults(
        filterLibraryEntriesByCreatedAt(ranked, structuredSearch.since, structuredSearch.until)
      )
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

    const mergeFieldEntries = (
      fieldName: string,
      entries: LibraryPublicationEntry[],
      mergedIndexEvents?: Event[]
    ) => {
      if (cancelled) return
      for (const entry of entries) {
        mergeEntryIntoMap(resultMap, entry)
        const key = entryKey(entry)
        let hits = fieldHits.get(key)
        if (!hits) {
          hits = new Set<string>()
          fieldHits.set(key, hits)
        }
        hits.add(fieldName)
      }
      applyMergedIndex(mergedIndexEvents)
      scheduleFlush()
    }

    void (async () => {
      // Date-only: filter already-loaded top-level indexes, then top up via events/filter with since/until.
      if (fields.length === 0 && createdAt) {
        for (const entry of libraryEntriesMatchingCreatedAt(
          indexEventsRef.current,
          EMPTY_ENGAGEMENT,
          createdAt.since,
          createdAt.until
        )) {
          mergeEntryIntoMap(resultMap, entry)
        }
        flush()

        try {
          const relays = await buildLibraryRelayUrls(pubkey || undefined, blockedRelays ?? [])
          const merged = await fetchLibraryIndexEvents(relays, {
            firstPageOnly: true,
            since: createdAt.since,
            until: createdAt.until,
            onProgress: (events) => {
              if (cancelled) return
              applyMergedIndex(events)
              for (const entry of libraryEntriesMatchingCreatedAt(
                events,
                EMPTY_ENGAGEMENT,
                createdAt.since,
                createdAt.until
              )) {
                mergeEntryIntoMap(resultMap, entry)
              }
              scheduleFlush()
            }
          })
          if (cancelled) return
          applyMergedIndex(merged)
          for (const entry of libraryEntriesMatchingCreatedAt(
            merged,
            EMPTY_ENGAGEMENT,
            createdAt.since,
            createdAt.until
          )) {
            mergeEntryIntoMap(resultMap, entry)
          }
        } catch (e) {
          if (import.meta.env.DEV) {
            logger.warn('[Library] date-only index fetch failed', {
              message: e instanceof Error ? e.message : String(e)
            })
          }
        }
        if (cancelled) return
        flush()
        setSearchLoading(false)
        return
      }

      // Phase A: local search for each filled field, ranked by matched-field count.
      await Promise.all(
        fields.map(async (f) => {
          try {
            if (isLibraryStructuredTagField(f.field)) {
              const local = searchLibraryPublicationsByStructuredTagField(
                f.field,
                f.value,
                { indexEvents: indexEventsRef.current, engagement: EMPTY_ENGAGEMENT },
                {
                  onProgress: ({ entries, mergedIndexEvents }) =>
                    mergeFieldEntries(f.field, entries, mergedIndexEvents)
                }
              )
              mergeFieldEntries(f.field, local)
              return
            }
            const local = await searchLibraryPublications(
              f.value,
              { indexEvents: indexEventsRef.current, engagement: EMPTY_ENGAGEMENT },
              f.axis,
              {
                onProgress: ({ entries, mergedIndexEvents }) =>
                  mergeFieldEntries(f.field, entries, mergedIndexEvents)
              }
            )
            mergeFieldEntries(f.field, local)
          } catch (e) {
            if (import.meta.env.DEV) {
              logger.warn('[Library] structured local search failed', {
                field: f.field,
                message: e instanceof Error ? e.message : String(e)
              })
            }
          }
        })
      )
      if (cancelled) return
      flush()

      // Phase B: always remote — Mercury HTTP + WS per field (never skip for local AND hits).
      try {
        const relays = await buildLibraryRelayUrls(pubkey || undefined, blockedRelays ?? [])
        await Promise.all(
          fields.map(async (f) => {
            try {
              if (isLibraryStructuredTagField(f.field)) {
                await searchLibraryPublicationsOnRelaysByStructuredTagField(
                  f.field,
                  f.value,
                  relays,
                  { indexEvents: indexEventsRef.current, engagement: EMPTY_ENGAGEMENT },
                  {
                    blockedRelays: blockedRelays ?? [],
                    createdAt,
                    onProgress: ({ entries, mergedIndexEvents }) =>
                      mergeFieldEntries(f.field, entries, mergedIndexEvents)
                  }
                )
                return
              }
              await searchLibraryPublicationsOnRelays(
                f.value,
                relays,
                { indexEvents: indexEventsRef.current, engagement: EMPTY_ENGAGEMENT },
                {
                  forceRefresh: true,
                  axis: f.axis,
                  blockedRelays: blockedRelays ?? [],
                  createdAt,
                  onProgress: ({ entries, mergedIndexEvents }) =>
                    mergeFieldEntries(f.field, entries, mergedIndexEvents)
                }
              )
            } catch (e) {
              if (import.meta.env.DEV) {
                logger.warn('[Library] structured relay search failed', {
                  field: f.field,
                  message: e instanceof Error ? e.message : String(e)
                })
              }
            }
          })
        )
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Relay search failed'
        if (import.meta.env.DEV) {
          logger.warn('[Library] structured relay search failed', { message })
        }
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
    structuredSearch,
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
    committedSearch: activeSearch,
    searchAxis,
    commitSearch,
    commitStructuredSearch,
    resetSearch,
    structuredSearch,
    debouncedSearch,
    searchLoading,
    searchResults
  }
}
