import storage from '@/services/local-storage.service'
import NoteList, { TNoteListRef } from '@/components/NoteList'
import { RefreshButton } from '@/components/RefreshButton'
import Tabs, { TabDefinition } from '@/components/Tabs'
import { useGlobalRelayBootstrapDefaults } from '@/hooks/use-global-relay-bootstrap-defaults'
import { useKindFilterOrDefaults } from '@/providers/KindFilterProvider'
import { HOME_GALLERY_TAB_KINDS, FAST_READ_RELAY_URLS } from '@/constants'
import { isWispTrendingNotesRelayUrl } from '@/lib/wisp-trending-relay'
import type { TPrimaryPageName } from '@/PageManager'
import { TFeedSubRequest, TNoteListMode } from '@/types'
import { cn } from '@/lib/utils'
import { normalizeAnyRelayUrl } from '@/lib/url'
import type { Event } from 'nostr-tools'
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import KindFilter from '../KindFilter'

/**
 * Home Gallery: favorites (or chip relays) first, then {@link FAST_READ_RELAY_URLS} so NIP-71 / picture
 * events are not starved when the user’s relay set is mostly text timelines. Deduped by normalized URL.
 */
function galleryRelayUrlsMergedWithReadLayer(
  favoriteUrls: readonly string[],
  mergeGlobalFastRead: boolean
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (raw: string) => {
    const n = normalizeAnyRelayUrl(raw.trim()) || raw.trim()
    if (!n) return
    const k = n.toLowerCase()
    if (seen.has(k)) return
    seen.add(k)
    out.push(n)
  }
  for (const u of favoriteUrls) add(u)
  if (mergeGlobalFastRead) {
    for (const u of FAST_READ_RELAY_URLS) add(u)
  }
  return out
}

const NormalFeed = forwardRef<TNoteListRef, {
  subRequests: TFeedSubRequest[]
  areAlgoRelays?: boolean
  /** When false, NoteList waits before opening timeline REQs (relay algo probe). */
  relayCapabilityReady?: boolean
  isMainFeed?: boolean
  /** When set (e.g. on Home), tabs are rendered in layout subHeader instead of in-feed; avoids overlap */
  setSubHeader?: (node: React.ReactNode) => void
  /** Shown in the subHeader row to the left of the kind filter (mobile primary feed). */
  onSubHeaderRefresh?: () => void
  /**
   * When true with {@link mergeTimelineWhenSubRequestFiltersMatch}, relay URL list can change (e.g. favorites
   * hydrate after load) without clearing rows — same REQ shape, merge new stream into existing events.
   */
  preserveTimelineOnSubRequestsChange?: boolean
  mergeTimelineWhenSubRequestFiltersMatch?: boolean
  /** Home Replies can widen relays without changing Notes/Gallery. */
  repliesSubRequests?: TFeedSubRequest[]
  /**
   * When set on the home main feed, Gallery tab REQ uses this relay stack (same as {@link repliesSubRequests})
   * instead of OP-only {@link subRequests} URLs.
   */
  mainFeedGalleryRelayUrls?: string[]
  /** Main Gallery historically widened with fast read relays; home can opt out to stay favorites+trending only. */
  widenMainGalleryRelays?: boolean
  /** Home following: second subscribe wave (delta relays / new authors); see {@link NoteList}. */
  followingFeedDeltaSubRequests?: TFeedSubRequest[]
  /** Stable subscription identity; see {@link NoteList} `feedSubscriptionKey`. */
  feedSubscriptionKey?: string
  /** Home favorite-relays chip scope; see {@link NoteList} `feedTimelineScopeKey`. */
  feedTimelineScopeKey?: string
  /** Single-relay Explore / chip: kindless REQ (see `SINGLE_RELAY_KINDLESS_REQ_LIMIT` in constants). */
  useFilterAsIs?: boolean
  clientSideKindFilter?: boolean
  allowKindlessRelayExplore?: boolean
  /**
   * Default true (home following, favorites, sets, single-relay chip): kind picker narrows visible rows.
   * Ignored when {@link showAllKinds} is effectively true.
   */
  withKindFilter?: boolean
  /**
   * When true (relay explorer page), list shows the full relay batch. When omitted, uses KindFilter "All Events"
   * ({@link useKindFilterOrDefaults} / persisted bypass) on home feeds.
   */
  showAllKinds?: boolean
  /**
   * Client-side 🔍 feed filter. When omitted: hidden on main following, shown on relay explore and non-main feeds.
   */
  showFeedClientFilter?: boolean
  /** When set, {@link NoteList} clears 🔍 filters when another primary tab is shown (mounted-but-hidden pages). */
  hostPrimaryPageName?: TPrimaryPageName
  /** Single-relay kindless wave EOSEd with no events: parent re-subscribes with explicit kinds. */
  onSingleRelayKindlessEmpty?: () => void
  /** Shown above the feed list (e.g. after kindless→kinds fallback on a single-relay chip). */
  feedTopNotice?: ReactNode
  /** Passed through to {@link NoteList} (d-tag browse one-shot). */
  oneShotFetch?: boolean
  progressiveWarmupQuery?: string
  progressiveWarmupMatch?: (ev: Event) => boolean
  /** Union into kind picker kinds for REQ + UI when set (e.g. document kinds on search / d-tag feeds). */
  progressiveDocumentKinds?: readonly number[]
  oneShotAfterMergeComparator?: (a: Event, b: Event) => number
  extraShouldHideEvent?: (ev: Event) => boolean
  extraShouldHideRepliesEvent?: (ev: Event) => boolean
  /** When set with home Gallery, filters rows (e.g. aggr-only) using the widened relay stack. */
  extraShouldHideGalleryEvent?: (ev: Event) => boolean
  /** Override default cap for merged one-shot batches (wide d-tag / search merges). */
  oneShotMergedCap?: number
  /** When every relay in the subscribe wave fails before EOSE, merge a one-shot fetch from default read relays (home multi-relay feeds). */
  timelinePublicReadFallback?: boolean
  /** When the feed is empty and terminal, {@link NoteList} can show an Alexandria search link (hashtag / d-tag pages). */
  alexandriaEmptyUrl?: string | null
  /**
   * Single-relay explore: only events from that relay’s live REQ (no session/IDB prime, no prefetch to other relays).
   */
  relayAuthoritativeFeedOnly?: boolean
  /** Home favorites Notes tab: favorites + trending relays for stats / “Seen on”. */
  homeFeedSeenOnAllowlistOp?: string[]
  /** Home favorites Replies / Gallery: adds NIP-65, cache, and HTTP index read relays. */
  homeFeedSeenOnAllowlistReplies?: string[]
}>(function NormalFeed(
  {
    subRequests,
    areAlgoRelays = false,
    relayCapabilityReady = true,
    isMainFeed = false,
    setSubHeader,
    onSubHeaderRefresh,
    preserveTimelineOnSubRequestsChange = false,
    mergeTimelineWhenSubRequestFiltersMatch = false,
    repliesSubRequests,
    mainFeedGalleryRelayUrls,
    widenMainGalleryRelays = true,
    followingFeedDeltaSubRequests,
    feedSubscriptionKey,
    feedTimelineScopeKey,
    useFilterAsIs = false,
    clientSideKindFilter = false,
    allowKindlessRelayExplore = false,
    withKindFilter = true,
    showAllKinds: showAllKindsProp,
    showFeedClientFilter: showFeedClientFilterProp,
    hostPrimaryPageName,
    onSingleRelayKindlessEmpty,
    feedTopNotice,
    oneShotFetch = false,
    progressiveWarmupQuery,
    progressiveWarmupMatch,
    progressiveDocumentKinds,
    oneShotAfterMergeComparator,
    extraShouldHideEvent,
    extraShouldHideRepliesEvent,
    extraShouldHideGalleryEvent,
    oneShotMergedCap,
    timelinePublicReadFallback = false,
    alexandriaEmptyUrl = null,
    relayAuthoritativeFeedOnly = false,
    homeFeedSeenOnAllowlistOp,
    homeFeedSeenOnAllowlistReplies
  },
  ref
) {
  const useGlobalRelayBootstrap = useGlobalRelayBootstrapDefaults()
  const { showKinds, showKind1OPs, showKind1Replies, showKind1111, feedKindFilterBypass } =
    useKindFilterOrDefaults()
  const [listMode, setListMode] = useState<TNoteListMode>(() => {
    const storedMode = storage.getNoteListMode()
    if (isMainFeed) {
      if (storedMode === 'posts' || storedMode === 'postsAndReplies') {
        return storedMode
      }
      return 'posts'
    }
    // Non-main feeds only expose Notes / Replies tabs — ignore stored "media" from the home gallery tab.
    if (storedMode === 'posts' || storedMode === 'postsAndReplies') {
      return storedMode
    }
    return 'posts'
  })
  const internalNoteListRef = useRef<TNoteListRef>(null)
  const noteListRef = ref || internalNoteListRef
  const [feedFilterTabRowHost, setFeedFilterTabRowHost] = useState<HTMLDivElement | null>(null)
  const onFeedFilterTabRowSlotRef = useCallback((node: HTMLDivElement | null) => {
    setFeedFilterTabRowHost((prev) => (Object.is(prev, node) ? prev : node))
  }, [])

  const MEDIA_KINDS = useMemo(() => [...HOME_GALLERY_TAB_KINDS], [])

  /** Every shard URL is a nostrarchives Wisp “trending notes” stream — replies/gallery tabs are not applicable. */
  const isWispTrendingOnlyFeed = useMemo(
    () =>
      subRequests.length > 0 &&
      subRequests.every(
        (req) => req.urls.length > 0 && req.urls.every((u) => isWispTrendingNotesRelayUrl(u))
      ),
    [subRequests]
  )

  useEffect(() => {
    if (!isWispTrendingOnlyFeed) return
    setListMode((m) => (m === 'posts' ? m : 'posts'))
  }, [isWispTrendingOnlyFeed])

  const tabs = useMemo((): TabDefinition[] => {
    if (isMainFeed && isWispTrendingOnlyFeed) {
      return [{ value: 'posts', label: 'Notes' }]
    }
    const base: TabDefinition[] = [
      { value: 'posts', label: 'Notes' },
      { value: 'postsAndReplies', label: 'Replies' }
    ]
    if (isMainFeed) base.push({ value: 'media', label: 'Gallery' })
    return base
  }, [isMainFeed, isWispTrendingOnlyFeed])

  /** Replies may widen relays; Gallery swaps kinds and may use {@link mainFeedGalleryRelayUrls} on home. */
  const effectiveSubRequests = useMemo(() => {
    if (listMode === 'postsAndReplies' && repliesSubRequests) {
      return repliesSubRequests
    }
    if (listMode !== 'media') return subRequests
    return subRequests.map((req) => ({
      ...req,
      urls:
        isMainFeed && mainFeedGalleryRelayUrls && mainFeedGalleryRelayUrls.length > 0
          ? mainFeedGalleryRelayUrls
          : isMainFeed && widenMainGalleryRelays
            ? galleryRelayUrlsMergedWithReadLayer(req.urls, useGlobalRelayBootstrap)
            : req.urls,
      filter: { ...req.filter, kinds: MEDIA_KINDS }
    }))
  }, [
    listMode,
    subRequests,
    repliesSubRequests,
    MEDIA_KINDS,
    isMainFeed,
    widenMainGalleryRelays,
    mainFeedGalleryRelayUrls,
    useGlobalRelayBootstrap
  ])

  const noteListExtraShouldHide = useMemo(() => {
    if (listMode === 'postsAndReplies') return extraShouldHideRepliesEvent
    if (listMode === 'media' && extraShouldHideGalleryEvent) return extraShouldHideGalleryEvent
    return extraShouldHideEvent
  }, [listMode, extraShouldHideRepliesEvent, extraShouldHideGalleryEvent, extraShouldHideEvent])

  const handleListModeChange = useCallback(
    (mode: TNoteListMode | string) => {
      const noteListMode = mode as TNoteListMode
      setListMode(noteListMode)
      if (isMainFeed) {
        storage.setNoteListMode(noteListMode)
        window.dispatchEvent(new CustomEvent('noteListModeChanged'))
      }
      if (noteListRef && typeof noteListRef !== 'function') {
        noteListRef.current?.scrollToTop('smooth')
      }
    },
    [isMainFeed, noteListRef]
  )

  const handleShowKindsChange = useCallback((_newShowKinds: number[]) => {
    if (noteListRef && typeof noteListRef !== 'function') {
      noteListRef.current?.scrollToTop()
    }
  }, [noteListRef])

  const showKindsKey = useMemo(() => JSON.stringify(showKinds), [showKinds])

  /** Relay detail + kindless home chip use {@link useFilterAsIs}; include it so the 🔍 row is not dropped if only one flag is set. */
  const showFeedClientFilter = useMemo(
    () =>
      showFeedClientFilterProp ??
      (!isMainFeed || allowKindlessRelayExplore || useFilterAsIs),
    [showFeedClientFilterProp, isMainFeed, allowKindlessRelayExplore, useFilterAsIs]
  )

  /**
   * Relay explorer passes {@link showAllKinds} explicitly. Home feeds tie bypass to visible rows so
   * "See all events" shows the full merged batch, not only REQ-widened fetches with picker filtering.
   */
  const listShowAllKinds = showAllKindsProp ?? feedKindFilterBypass

  /** Include kind picker deps for single-relay chips (kindless REQ + client-side kinds). */
  const subHeaderFilterDepsKey = `${allowKindlessRelayExplore ? 'kle' : 'std'}|${showKindsKey}|${feedKindFilterBypass}|${showAllKindsProp ? 'allProp' : 'k'}`

  const renderTabsInFeed = !(isMainFeed && setSubHeader) && !allowKindlessRelayExplore

  const mergeFilterWithTabsRow =
    showFeedClientFilter && ((isMainFeed && !!setSubHeader) || renderTabsInFeed)

  /** Notes / Replies / Gallery switch, plus refresh + kind filter — on Wisp trending only the tool row (no mode tabs). */
  const tabsElement = useMemo(() => {
    const kindRowOptions = (
      <div className="flex items-center gap-0">
        {onSubHeaderRefresh != null && <RefreshButton onClick={onSubHeaderRefresh} />}
        <KindFilter showKinds={showKinds} onShowKindsChange={handleShowKindsChange} />
        {mergeFilterWithTabsRow ? (
          <div ref={onFeedFilterTabRowSlotRef} className="flex items-center" />
        ) : null}
      </div>
    )
    if (isMainFeed && isWispTrendingOnlyFeed) {
      return (
        <div className="flex w-full min-w-0 items-center justify-end gap-0 py-1">{kindRowOptions}</div>
      )
    }
    return (
      <Tabs
        value={listMode}
        tabs={tabs}
        onTabChange={handleListModeChange}
        options={kindRowOptions}
      />
    )
  }, [
    isMainFeed,
    isWispTrendingOnlyFeed,
    listMode,
    tabs,
    handleListModeChange,
    showKinds,
    onSubHeaderRefresh,
    handleShowKindsChange,
    mergeFilterWithTabsRow
  ])

  const tabRowChromeClass =
    'w-full min-w-0 border-b border-border/80 bg-background/95 pb-1.5 pt-0.5 backdrop-blur supports-[backdrop-filter]:bg-background/80'

  /**
   * Push the tab row into {@link PrimaryPageLayout} subHeader. Use `useEffect` (not `useLayoutEffect`) so
   * parent `setHomeSubHeader` runs after paint; synchronous layout updates here caused React #185
   * (maximum update depth) when navigating onto the home feed after other primaries (e.g. notifications).
   * Intentionally omit `tabsElement` from deps — covered by `listMode` + `subHeaderFilterDepsKey`.
   * Omit `onSubHeaderRefresh` / `onFeedFilterTabRowSlotRef`: only embedded in `tabsElement`; unstable
   * identities there would retrigger every render and loop with parent state.
   * Do not clear subHeader between dep updates — nulling remounts the filter portal slot and retriggers
   * NoteList subscriptions / layout churn on the home feed.
   */
  useEffect(() => {
    if (!isMainFeed || !setSubHeader) return
    if (mergeFilterWithTabsRow) {
      setSubHeader(<div className={tabRowChromeClass}>{tabsElement}</div>)
    } else {
      setSubHeader(tabsElement)
    }
  }, [
    isMainFeed,
    setSubHeader,
    listMode,
    isWispTrendingOnlyFeed,
    subHeaderFilterDepsKey,
    allowKindlessRelayExplore,
    mergeFilterWithTabsRow
  ])

  useEffect(() => {
    if (!isMainFeed || !setSubHeader) return
    return () => setSubHeader(null)
  }, [isMainFeed, setSubHeader])

  return (
    <>
      {renderTabsInFeed &&
        (mergeFilterWithTabsRow ? (
          <div className={cn('sticky top-0 z-20', tabRowChromeClass)}>{tabsElement}</div>
        ) : (
          tabsElement
        ))}
      <div
        className={cn('min-w-0', mergeFilterWithTabsRow && renderTabsInFeed ? 'pt-0' : 'pt-2')}
      >
        <NoteList
          ref={noteListRef}
          showKinds={showKinds}
          showKind1OPs={showKind1OPs}
          showKind1Replies={showKind1Replies}
          showKind1111={showKind1111}
          seeAllFeedEvents={feedKindFilterBypass}
          withKindFilter={withKindFilter}
          subRequests={effectiveSubRequests}
          hideReplies={listMode === 'posts'}
          areAlgoRelays={areAlgoRelays}
          relayCapabilityReady={relayCapabilityReady}
          feedSubscriptionKey={feedSubscriptionKey}
          preserveTimelineOnSubRequestsChange={preserveTimelineOnSubRequestsChange}
          mergeTimelineWhenSubRequestFiltersMatch={mergeTimelineWhenSubRequestFiltersMatch}
          followingFeedDeltaSubRequests={followingFeedDeltaSubRequests}
          feedTimelineScopeKey={feedTimelineScopeKey}
          homeFeedListMode={isMainFeed ? listMode : undefined}
          homeFeedSeenOnAllowlistOp={homeFeedSeenOnAllowlistOp}
          homeFeedSeenOnAllowlistReplies={homeFeedSeenOnAllowlistReplies}
          gridLayout={listMode === 'media'}
          revealBatchSize={listMode === 'media' && isMainFeed ? 96 : undefined}
          useFilterAsIs={listMode === 'media' ? true : useFilterAsIs}
          clientSideKindFilter={listMode === 'media' ? false : clientSideKindFilter}
          allowKindlessRelayExplore={listMode === 'media' ? false : allowKindlessRelayExplore}
          showAllKinds={listMode === 'media' ? true : listShowAllKinds}
          showFeedClientFilter={showFeedClientFilter}
          hostPrimaryPageName={hostPrimaryPageName}
          feedClientFilterTabRowHost={mergeFilterWithTabsRow ? feedFilterTabRowHost : undefined}
          onSingleRelayKindlessEmpty={onSingleRelayKindlessEmpty}
          feedTopNotice={feedTopNotice}
          oneShotFetch={oneShotFetch}
          progressiveWarmupQuery={progressiveWarmupQuery}
          progressiveWarmupMatch={progressiveWarmupMatch}
          progressiveDocumentKinds={progressiveDocumentKinds}
          oneShotAfterMergeComparator={oneShotAfterMergeComparator}
          extraShouldHideEvent={noteListExtraShouldHide}
          oneShotMergedCap={oneShotMergedCap}
          timelinePublicReadFallback={timelinePublicReadFallback && listMode === 'postsAndReplies'}
          alexandriaEmptyUrl={alexandriaEmptyUrl}
          relayAuthoritativeFeedOnly={relayAuthoritativeFeedOnly}
        />
      </div>
    </>
  )
})

export default NormalFeed
