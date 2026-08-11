import { buildFeedSessionSnapshotKey, stableFeedKindKey } from '@/features/feed/descriptor'
import { useFeedAttestedSuperchatIds } from '@/hooks/useFeedAttestedSuperchatIds'
import { useViewerPersonalRelayKeysRevision } from '@/hooks/useViewerPersonalRelayKeysRevision'
import { isWispTrendingNotesRelayUrl } from '@/lib/wisp-trending-relay'
import { useContentPolicyOptional } from '@/providers/ContentPolicyProvider'
import { useKindFilterOrDefaults } from '@/providers/KindFilterProvider'
import { useFeed } from '@/providers/feed-context'
import { useMuteList } from '@/contexts/mute-list-context'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import type { RelayOpTerminalRow } from '@/services/relay-operation-log.service'
import type { TNoteListMode } from '@/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Event } from 'nostr-tools'
import {
  buildHomeFeedDescriptorBundle,
  type HomeFeedDescriptorBundle
} from './buildHomeFeedDescriptor'
import { HomeFeedEngine, type HomeFeedEngineSnapshot } from './HomeFeedEngine'
import {
  filterVisibleHomeFeedEvents,
  type HomeFeedFilterContext
} from './homeFeedFilters'
import {
  HOME_FEED_INITIAL_SHOW_COUNT,
  HOME_FEED_REVEAL_BATCH
} from './constants'
import { checkAlgoRelay } from '@/lib/relay'
import relayInfoService from '@/services/relay-info.service'

export type UseHomeFeedResult = {
  bundle: HomeFeedDescriptorBundle | null
  visibleEvents: Event[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  error?: string
  listMode: TNoteListMode
  showCount: number
  pendingNewCount: number
  relayOutcomes: RelayOpTerminalRow[]
  emptyUiReady: boolean
  loadMore: () => void
  refresh: () => void
  flushPendingNew: () => void
  revealMore: () => void
  setScrolledFromTop: (away: boolean) => void
}

export function useHomeFeed(): UseHomeFeedResult {
  const { relayUrls, replyRelayUrls, homeFeedRelaySource } = useFeed()
  const {
    showKinds,
    showKind1OPs,
    showKind1Replies,
    showKind1111,
    feedKindFilterBypass: seeAllFeedEvents
  } = useKindFilterOrDefaults()
  const { pubkey } = useNostr()
  const { mutePubkeySet } = useMuteList()
  const contentPolicy = useContentPolicyOptional()
  const filterMutedNotes = true
  const hideContentMentioningMutedUsers =
    contentPolicy?.hideContentMentioningMutedUsers ?? false
  const [areAlgoRelays, setAreAlgoRelays] = useState(false)
  const [engineSnap, setEngineSnap] = useState<HomeFeedEngineSnapshot>({
    rawEvents: [],
    loading: false,
    loadingMore: false,
    hasMore: true,
    relayOutcomes: [],
    generation: 0,
    emptyUiReady: false
  })
  const [showCount, setShowCount] = useState(HOME_FEED_INITIAL_SHOW_COUNT)
  const [pendingNew, setPendingNew] = useState<Event[]>([])
  const [scrolledFromTop, setScrolledFromTop] = useState(false)
  const engineRef = useRef<HomeFeedEngine | null>(null)
  const personalRelayKeysRevision = useViewerPersonalRelayKeysRevision()
  const personalRelayBootRevisionRef = useRef(personalRelayKeysRevision)
  const scrolledFromTopRef = useRef(false)
  const pubkeyRef = useRef(pubkey)
  pubkeyRef.current = pubkey

  const listMode: TNoteListMode = useMemo(() => {
    const allWisp =
      relayUrls.length > 0 &&
      relayUrls.every((u) => isWispTrendingNotesRelayUrl(u))
    return allWisp ? 'posts' : 'postsAndReplies'
  }, [relayUrls])

  const hideReplies = listMode === 'posts'

  const bundle = useMemo(
    () =>
      buildHomeFeedDescriptorBundle({
        homeFeedRelaySource,
        relayUrls,
        replyRelayUrls,
        showKinds,
        listMode,
        seeAllFeedEvents,
        areAlgoRelays
      }),
    [
      homeFeedRelaySource,
      relayUrls,
      replyRelayUrls,
      showKinds,
      listMode,
      seeAllFeedEvents,
      areAlgoRelays
    ]
  )

  const feedAttestedSuperchatIds = useFeedAttestedSuperchatIds(relayUrls)

  useEffect(() => {
    if (relayUrls.length === 0) {
      setAreAlgoRelays(false)
      return
    }
    let cancelled = false
    void relayInfoService.getRelayInfos(relayUrls).then((infos) => {
      if (!cancelled) setAreAlgoRelays(infos.every((i) => checkAlgoRelay(i)))
    })
    return () => {
      cancelled = true
    }
  }, [relayUrls])

  const sessionSnapshotKey = useMemo(() => {
    if (!bundle) return ''
    return buildFeedSessionSnapshotKey({
      feedKey: bundle.subscriptionKey,
      homeSurface: listMode,
      kindsKey: stableFeedKindKey(showKinds),
      showKind1OPs,
      showKind1Replies,
      showKind1111,
      seeAllFeedEvents
    })
  }, [
    bundle,
    listMode,
    showKinds,
    showKind1OPs,
    showKind1Replies,
    showKind1111,
    seeAllFeedEvents
  ])

  const filterCtx = useMemo((): HomeFeedFilterContext | null => {
    if (!bundle) return null
    const seenOn =
      hideReplies || bundle.relaySetFeedOnly
        ? bundle.seenOnAllowlistOp
        : bundle.seenOnAllowlistReplies
    return {
      listMode,
      hideReplies,
      showKinds,
      showKind1OPs,
      showKind1Replies,
      showKind1111,
      applyKindPickerInUi: !seeAllFeedEvents,
      seeAllFeedEvents,
      filterMutedNotes,
      hideContentMentioningMutedUsers,
      mutePubkeySet,
      attestedSuperchatIds: feedAttestedSuperchatIds,
      seenOnAllowlist: seenOn,
      relayAuthoritativeFeedOnly: bundle.relaySetFeedOnly,
      getSeenOnRelays: (id) => client.getSeenEventRelayUrls(id)
    }
  }, [
    bundle,
    listMode,
    hideReplies,
    showKinds,
    showKind1OPs,
    showKind1Replies,
    showKind1111,
    seeAllFeedEvents,
    filterMutedNotes,
    hideContentMentioningMutedUsers,
    mutePubkeySet,
    feedAttestedSuperchatIds
  ])

  const visibleEvents = useMemo(() => {
    if (!filterCtx) return []
    return filterVisibleHomeFeedEvents(engineSnap.rawEvents, filterCtx, showCount)
  }, [engineSnap.rawEvents, filterCtx, showCount])

  // Create / destroy engine only when feed identity changes — not on personal-relay revision.
  useEffect(() => {
    if (!bundle) {
      engineRef.current?.destroy()
      engineRef.current = null
      setEngineSnap({
        rawEvents: [],
        loading: false,
        loadingMore: false,
        hasMore: false,
        relayOutcomes: [],
        generation: 0,
        emptyUiReady: true
      })
      return
    }

    const engine = new HomeFeedEngine({
      client: client as import('./HomeFeedEngine').HomeFeedEngineClient,
      bundle,
      sessionSnapshotKey,
      onChange: (snap) => {
        setEngineSnap(snap)
      },
      onLiveEvent: (event) => {
        if (pubkeyRef.current && event.pubkey === pubkeyRef.current) return 'merge'
        return scrolledFromTopRef.current ? 'pending' : 'merge'
      },
      onPendingEvents: (events) => {
        setPendingNew([...events])
      }
    })
    engineRef.current = engine
    personalRelayBootRevisionRef.current = personalRelayKeysRevision
    void engine.start(false)

    return () => {
      engine.destroy()
      if (engineRef.current === engine) engineRef.current = null
    }
    // personalRelayKeysRevision intentionally omitted — soft-resubscribe below.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- identity-only recreate
  }, [bundle?.descriptor.key, bundle?.subscriptionKey, sessionSnapshotKey])

  // Keep descriptor fresh when URLs/kinds change inside the same identity key.
  useEffect(() => {
    if (!bundle) return
    engineRef.current?.updateBundle(bundle, sessionSnapshotKey)
  }, [bundle, sessionSnapshotKey])

  // Personal-relay key sync: soft restart so sanitization picks up new grants without row teardown.
  useEffect(() => {
    if (personalRelayBootRevisionRef.current === personalRelayKeysRevision) return
    personalRelayBootRevisionRef.current = personalRelayKeysRevision
    const engine = engineRef.current
    if (!engine || !bundle) return
    engine.updateBundle(bundle, sessionSnapshotKey)
    void engine.start(false)
  }, [personalRelayKeysRevision, bundle, sessionSnapshotKey])

  useEffect(() => {
    scrolledFromTopRef.current = scrolledFromTop
  }, [scrolledFromTop])

  const refresh = useCallback(() => {
    setShowCount(HOME_FEED_INITIAL_SHOW_COUNT)
    setPendingNew([])
    engineRef.current?.refresh()
  }, [])

  const loadMore = useCallback(() => {
    if (showCount < engineSnap.rawEvents.length) {
      setShowCount((n) => n + HOME_FEED_REVEAL_BATCH)
      return
    }
    void engineRef.current?.loadMore()
  }, [showCount, engineSnap.rawEvents.length])

  const revealMore = useCallback(() => {
    setShowCount((n) => n + HOME_FEED_REVEAL_BATCH)
  }, [])

  const flushPendingNew = useCallback(() => {
    engineRef.current?.flushPendingLive()
    setPendingNew([])
    setScrolledFromTop(false)
  }, [])

  const setScrolledFromTopWrapped = useCallback((away: boolean) => {
    setScrolledFromTop(away)
    if (!away) {
      setPendingNew([])
    }
  }, [])

  return {
    bundle,
    visibleEvents,
    loading: engineSnap.loading && engineSnap.rawEvents.length === 0,
    loadingMore: engineSnap.loadingMore,
    hasMore:
      engineSnap.hasMore ||
      showCount < engineSnap.rawEvents.length ||
      pendingNew.length > 0,
    error: engineSnap.error,
    listMode,
    showCount,
    pendingNewCount: pendingNew.length,
    relayOutcomes: engineSnap.relayOutcomes,
    emptyUiReady: engineSnap.emptyUiReady,
    loadMore,
    refresh,
    flushPendingNew,
    revealMore,
    setScrolledFromTop: setScrolledFromTopWrapped
  }
}
