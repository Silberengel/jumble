import NormalFeed from '@/components/NormalFeed'
import type { TNoteListRef } from '@/components/NoteList'
import { ensureHomeFeedTrendingRelay } from '@/lib/home-feed-relays'
import { checkAlgoRelay } from '@/lib/relay'
import { dedupeNormalizeRelayUrlsOrdered } from '@/lib/relay-url-priority'
import { normalizeUrl } from '@/lib/url'
import { useFeed } from '@/providers/feed-context'
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
  const { relayUrls, replyRelayUrls } = useFeed()
  const { showKinds } = useKindFilterOrDefaults()
  const [areAlgoRelays, setAreAlgoRelays] = useState(false)
  /** Timeline REQs must not wait on NIP-11; cache/IDB serves algo detection in the background. */
  const [relayCapabilityReady, setRelayCapabilityReady] = useState(true)

  const relayUrlsKey = useMemo(
    () =>
      [...relayUrls]
        .map((u) => normalizeUrl(u) || u)
        .filter(Boolean)
        .sort()
        .join('|'),
    [relayUrls]
  )
  const replyRelayUrlsKey = useMemo(
    () =>
      [...replyRelayUrls]
        .map((u) => normalizeUrl(u) || u)
        .filter(Boolean)
        .sort()
        .join('|'),
    [replyRelayUrls]
  )
  const stableRelayUrls = useMemo(
    () => dedupeNormalizeRelayUrlsOrdered(relayUrls),
    [relayUrlsKey]
  )
  const stableReplyRelayUrls = useMemo(
    () => dedupeNormalizeRelayUrlsOrdered(replyRelayUrls),
    [replyRelayUrlsKey]
  )
  const homeFeedSeenOnAllowlistOp = useMemo(() => stableRelayUrls, [relayUrlsKey])
  const homeFeedSeenOnAllowlistReplies = useMemo(() => stableReplyRelayUrls, [replyRelayUrlsKey])

  useEffect(() => {
    if (stableRelayUrls.length === 0) {
      setAreAlgoRelays(false)
      setRelayCapabilityReady(false)
      return
    }
    setRelayCapabilityReady(true)

    let cancelled = false
    void (async () => {
      try {
        // Memory + IndexedDB cache first; network only for stale/missing (see relay-info.service).
        const relayInfos = await relayInfoService.getRelayInfos(stableRelayUrls)
        if (cancelled) return
        setAreAlgoRelays(relayInfos.every((relayInfo) => checkAlgoRelay(relayInfo)))
      } catch {
        if (!cancelled) setAreAlgoRelays(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [relayUrlsKey, stableRelayUrls])

  /** Stable identity when kind filter is empty so `subRequests` does not invalidate every render. */
  const fallbackNoteKinds = useMemo(() => [kinds.ShortTextNote], [])
  const defaultKinds = useMemo(() => {
    if (kindsOverride && kindsOverride.length > 0) return kindsOverride
    if (showKinds.length > 0) return showKinds
    return fallbackNoteKinds
  }, [kindsOverride, showKinds, fallbackNoteKinds])
  const defaultKindsKey = useMemo(() => JSON.stringify(defaultKinds), [defaultKinds])

  const canRenderFeed = stableRelayUrls.length > 0

  // Hooks must run every render — never place useMemo after conditional returns.
  const subRequests = useMemo(() => {
    if (!canRenderFeed) return []
    return [
      {
        urls: dedupeNormalizeRelayUrlsOrdered(ensureHomeFeedTrendingRelay(stableRelayUrls)),
        filter: {
          kinds: defaultKinds
        }
      }
    ]
  }, [canRenderFeed, relayUrlsKey, stableRelayUrls, defaultKindsKey, defaultKinds])
  const repliesSubRequests = useMemo(() => {
    if (!canRenderFeed) return []
    const replyUrls =
      stableReplyRelayUrls.length > 0 ? stableReplyRelayUrls : stableRelayUrls
    return [
      {
        urls: dedupeNormalizeRelayUrlsOrdered(ensureHomeFeedTrendingRelay(replyUrls)),
        filter: {
          kinds: defaultKinds
        }
      }
    ]
  }, [
    canRenderFeed,
    replyRelayUrlsKey,
    stableReplyRelayUrls,
    relayUrlsKey,
    stableRelayUrls,
    defaultKindsKey,
    defaultKinds
  ])

  if (!canRenderFeed) {
    return null
  }

  // preserveTimeline: merge when relay list grows (e.g. all-favorites list fills in).
  return (
    <NormalFeed
      ref={ref}
      subRequests={subRequests}
      areAlgoRelays={areAlgoRelays}
      relayCapabilityReady={relayCapabilityReady}
      isMainFeed
      setSubHeader={setSubHeader}
      onSubHeaderRefresh={onSubHeaderRefresh}
      preserveTimelineOnSubRequestsChange
      repliesSubRequests={repliesSubRequests}
      feedSubscriptionKey="home-all-favorites"
      feedTimelineScopeKey="all-favorites"
      homeFeedSeenOnAllowlistOp={homeFeedSeenOnAllowlistOp}
      homeFeedSeenOnAllowlistReplies={homeFeedSeenOnAllowlistReplies}
      showFeedClientFilter
      hostPrimaryPageName="feed"
    />
  )
})

RelaysFeed.displayName = 'RelaysFeed'
export default RelaysFeed
