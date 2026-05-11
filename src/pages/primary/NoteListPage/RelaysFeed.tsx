import NormalFeed from '@/components/NormalFeed'
import type { TNoteListRef } from '@/components/NoteList'
import { checkAlgoRelay } from '@/lib/relay'
import {
  isWispTrendingNotesRelayUrl,
  WISP_TRENDING_FEED_KINDS
} from '@/lib/wisp-trending-relay'
import { normalizeAnyRelayUrl, normalizeUrl } from '@/lib/url'
import { useFeed } from '@/providers/FeedProvider'
import { useKindFilterOrDefaults } from '@/providers/KindFilterProvider'
import relayInfoService from '@/services/relay-info.service'
import { kinds } from 'nostr-tools'
import React, { forwardRef, useEffect, useMemo, useState } from 'react'

const RelaysFeed = forwardRef<
  TNoteListRef,
  {
    setSubHeader?: (node: React.ReactNode) => void
    onSubHeaderRefresh?: () => void
    /** When set, subscription kinds (fixed list); otherwise uses KindFilterProvider. */
    kindsOverride?: number[]
  }
>(function RelaysFeed({ setSubHeader, onSubHeaderRefresh, kindsOverride }, ref) {
  const { feedInfo, relayUrls } = useFeed()
  const { showKinds } = useKindFilterOrDefaults()
  const [areAlgoRelays, setAreAlgoRelays] = useState(false)

  const relayUrlsKey = useMemo(
    () =>
      [...relayUrls]
        .map((u) => normalizeUrl(u) || u)
        .filter(Boolean)
        .sort()
        .join('|'),
    [relayUrls]
  )

  useEffect(() => {
    if (relayUrls.length === 0) {
      setAreAlgoRelays(false)
      return
    }
    let cancelled = false

    const init = async () => {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('getRelayInfos timeout after 8 seconds'))
        }, 8000)
      })

      try {
        const relayInfos = await Promise.race([
          relayInfoService.getRelayInfos(relayUrls),
          timeoutPromise
        ])
        if (cancelled) return
        const areAlgo = relayInfos.every((relayInfo) => checkAlgoRelay(relayInfo))
        setAreAlgoRelays(areAlgo)
      } catch (_error) {
        if (!cancelled) setAreAlgoRelays(false)
      }
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [relayUrlsKey, relayUrls.length])

  /** Stable identity when kind filter is empty so `subRequests` does not invalidate every render. */
  const fallbackNoteKinds = useMemo(() => [kinds.ShortTextNote], [])
  const defaultKinds = useMemo(() => {
    if (kindsOverride && kindsOverride.length > 0) return kindsOverride
    if (showKinds.length > 0) return showKinds
    return fallbackNoteKinds
  }, [kindsOverride, showKinds, fallbackNoteKinds])

  const canRenderFeed =
    (feedInfo.feedType === 'relay' ||
      feedInfo.feedType === 'relays' ||
      feedInfo.feedType === 'all-favorites') &&
    relayUrls.length > 0

  /** Distinguishes home relay chips so we do not keep the previous timeline on single→all-favorites (strict superset). */
  const feedTimelineScopeKey = useMemo(() => {
    if (feedInfo.feedType === 'all-favorites') return 'all-favorites'
    if (feedInfo.feedType === 'relays') return `relays:${feedInfo.id ?? ''}`
    if (feedInfo.feedType === 'relay') {
      /** Same canonical URL identity as {@link NoteList} `subRequestsKey` (not `normalizeUrl` alone — HTTP index relays differ). */
      const urlsKey = [...relayUrls]
        .map((u) => normalizeAnyRelayUrl(u) || u)
        .filter(Boolean)
        .sort()
        .join('|')
      if (urlsKey) return `relay:${urlsKey}`
      const id = feedInfo.id ? normalizeAnyRelayUrl(feedInfo.id) || feedInfo.id : ''
      return `relay:${id}`
    }
    return undefined
  }, [feedInfo.feedType, feedInfo.id, relayUrls])

  const wispTrendingSingleRelay =
    feedInfo.feedType === 'relay' &&
    relayUrls.length === 1 &&
    !!relayUrls[0] &&
    isWispTrendingNotesRelayUrl(relayUrls[0])

  // Hooks must run every render — never place useMemo after conditional returns.
  const subRequests = useMemo(() => {
    if (!canRenderFeed) return []
    if (wispTrendingSingleRelay) {
      return [
        {
          urls: relayUrls,
          filter: { kinds: [...WISP_TRENDING_FEED_KINDS], limit: 100 }
        }
      ]
    }
    return [
      {
        urls: relayUrls,
        filter: {
          kinds: defaultKinds
        }
      }
    ]
  }, [canRenderFeed, relayUrls, defaultKinds, wispTrendingSingleRelay])

  if (!canRenderFeed) {
    return null
  }

  // preserveTimeline: merge when relay list grows (e.g. all-favorites list fills in). Do not use
  // mergeTimelineWhenSubRequestFiltersMatch here — same kinds + different URLs would keep the old
  // timeline when switching home feed chips (all-favorites ↔ set ↔ single relay).
  return (
    <NormalFeed
      ref={ref}
      subRequests={subRequests}
      areAlgoRelays={wispTrendingSingleRelay || areAlgoRelays}
      isMainFeed
      setSubHeader={setSubHeader}
      onSubHeaderRefresh={onSubHeaderRefresh}
      preserveTimelineOnSubRequestsChange
      feedTimelineScopeKey={feedTimelineScopeKey}
      showFeedClientFilter
      hostPrimaryPageName="feed"
      /**
       * {@link timelinePublicReadFallback} uses {@link FAST_READ_RELAY_URLS} with the shard filter’s kinds only —
       * there is no “this relay URL” scope. For a **single chip**, that made every relay show the same global batch.
       * Keep fallback for multi-relay surfaces where a broad read matches user intent; single-chip feeds rely on
       * that relay + disk/session hydrate only.
       */
      timelinePublicReadFallback={
        feedInfo.feedType === 'all-favorites' ||
        (feedInfo.feedType === 'relays' && relayUrls.length > 1)
      }
    />
  )
})

RelaysFeed.displayName = 'RelaysFeed'
export default RelaysFeed
