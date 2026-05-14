import NormalFeed from '@/components/NormalFeed'
import type { TNoteListRef } from '@/components/NoteList'
import { isReplyNoteEvent } from '@/lib/event'
import { AGGR_NOSTR_LAND_WSS } from '@/lib/nostr-land-aggr'
import { checkAlgoRelay } from '@/lib/relay'
import { normalizeAnyRelayUrl, normalizeUrl } from '@/lib/url'
import { useFeed } from '@/providers/feed-context'
import { useKindFilterOrDefaults } from '@/providers/KindFilterProvider'
import client from '@/services/client.service'
import relayInfoService from '@/services/relay-info.service'
import { kinds, type Event } from 'nostr-tools'
import React, { forwardRef, useCallback, useEffect, useMemo, useState } from 'react'

const AGGR_RELAY_KEY = (normalizeAnyRelayUrl(AGGR_NOSTR_LAND_WSS) || AGGR_NOSTR_LAND_WSS).toLowerCase()

function relaySeenKey(url: string): string {
  return (normalizeAnyRelayUrl(url) || url.trim()).toLowerCase()
}

const RelaysFeed = forwardRef<
  TNoteListRef,
  {
    setSubHeader?: (node: React.ReactNode) => void
    onSubHeaderRefresh?: () => void
    /** When set, subscription kinds (fixed list); otherwise uses KindFilterProvider. */
    kindsOverride?: number[]
  }
>(function RelaysFeed({ setSubHeader, onSubHeaderRefresh, kindsOverride }, ref) {
  const { relayUrls, replyRelayUrls } = useFeed()
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
      } catch {
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

  const canRenderFeed = relayUrls.length > 0

  // Hooks must run every render — never place useMemo after conditional returns.
  const subRequests = useMemo(() => {
    if (!canRenderFeed) return []
    return [
      {
        urls: relayUrls,
        filter: {
          kinds: defaultKinds
        }
      }
    ]
  }, [canRenderFeed, relayUrls, defaultKinds])
  const repliesSubRequests = useMemo(() => {
    if (!canRenderFeed) return []
    return [
      {
        urls: replyRelayUrls.length > 0 ? replyRelayUrls : relayUrls,
        filter: {
          kinds: defaultKinds
        }
      }
    ]
  }, [canRenderFeed, replyRelayUrls, relayUrls, defaultKinds])
  const hideAggrOnlyMainFeedEvent = useCallback(
    (event: Event) => {
      const seenRelays = client.getSeenEventRelayUrls(event.id).map(relaySeenKey)
      if (!seenRelays.includes(AGGR_RELAY_KEY)) return false
      const allowedRelays = new Set(relayUrls.map(relaySeenKey))
      return !seenRelays.some((relay) => relay !== AGGR_RELAY_KEY && allowedRelays.has(relay))
    },
    [relayUrls]
  )
  const hideAggrOnlyReplyGalleryStackEvent = useCallback(
    (event: Event) => {
      const seenRelays = client.getSeenEventRelayUrls(event.id).map(relaySeenKey)
      if (!seenRelays.includes(AGGR_RELAY_KEY)) return false
      const allowedRelays = new Set(replyRelayUrls.map(relaySeenKey))
      return !seenRelays.some((relay) => relay !== AGGR_RELAY_KEY && allowedRelays.has(relay))
    },
    [replyRelayUrls]
  )
  const hideAggrOnlyNonReplyEvent = useCallback(
    (event: Event) => hideAggrOnlyMainFeedEvent(event) && !isReplyNoteEvent(event),
    [hideAggrOnlyMainFeedEvent]
  )

  if (!canRenderFeed) {
    return null
  }

  // preserveTimeline: merge when relay list grows (e.g. all-favorites list fills in).
  return (
    <NormalFeed
      ref={ref}
      subRequests={subRequests}
      areAlgoRelays={areAlgoRelays}
      isMainFeed
      setSubHeader={setSubHeader}
      onSubHeaderRefresh={onSubHeaderRefresh}
      preserveTimelineOnSubRequestsChange
      repliesSubRequests={repliesSubRequests}
      mainFeedGalleryRelayUrls={replyRelayUrls}
      widenMainGalleryRelays={false}
      feedSubscriptionKey="home-all-favorites"
      feedTimelineScopeKey="all-favorites"
      showFeedClientFilter
      hostPrimaryPageName="feed"
      extraShouldHideEvent={hideAggrOnlyMainFeedEvent}
      extraShouldHideGalleryEvent={hideAggrOnlyReplyGalleryStackEvent}
      extraShouldHideRepliesEvent={hideAggrOnlyNonReplyEvent}
      timelinePublicReadFallback
    />
  )
})

RelaysFeed.displayName = 'RelaysFeed'
export default RelaysFeed
