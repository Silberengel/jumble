import {
  clearAllLibraryIndexCaches,
  libraryDefaultFeedSlice,
  loadLibraryPublicationIndex,
  buildLibraryRelayUrls,
  type LibraryPublicationEntry,
  type PublicationEngagementMaps
} from '@/lib/library-publication-index'
import logger from '@/lib/logger'
import type { Event } from 'nostr-tools'
import { useCallback, useEffect, useRef, useState } from 'react'
import { SEARCH_INDEX_SETTLE_MS } from './config'
import { EMPTY_ENGAGEMENT } from './constants'

type IndexSnapshot = {
  indexEvents: Event[]
  allIndexCount: number
  topLevelCount: number
}

export function useLibraryIndexLoader(
  isActive: boolean,
  pubkey: string | null | undefined,
  blockedRelays: readonly string[]
) {
  const [entries, setEntries] = useState<LibraryPublicationEntry[]>([])
  const [feedPageIndex, setFeedPageIndex] = useState(0)
  const [feedTotalCount, setFeedTotalCount] = useState(0)
  const [indexEvents, setIndexEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [allIndexCount, setAllIndexCount] = useState(0)
  const [topLevelCount, setTopLevelCount] = useState(0)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [settledIndexCount, setSettledIndexCount] = useState(0)
  const forceRefreshNextLoadRef = useRef(false)
  const indexesReadyRef = useRef(false)

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
    (snapshot: IndexSnapshot, engagementMaps: PublicationEngagementMaps, pageIndex: number) => {
      setIndexEvents(snapshot.indexEvents)
      setAllIndexCount(snapshot.allIndexCount)
      setTopLevelCount(snapshot.topLevelCount)
      applyDefaultFeedSlice(snapshot.indexEvents, engagementMaps, pageIndex)
    },
    [applyDefaultFeedSlice]
  )

  useEffect(() => {
    if (indexEvents.length === 0) {
      setSettledIndexCount(0)
      return
    }
    const t = window.setTimeout(() => setSettledIndexCount(indexEvents.length), SEARCH_INDEX_SETTLE_MS)
    return () => window.clearTimeout(t)
  }, [indexEvents.length])

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

  const loadMoreFeed = useCallback(() => {
    setFeedPageIndex((page) => page + 1)
  }, [])

  return {
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
  }
}
