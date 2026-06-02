import storage from '@/services/local-storage.service'
import NoteList, { TNoteListRef } from '@/components/NoteList'
import FeedFilterToolbarRow, { feedFilterRowChromeClass } from '@/components/FeedFilterToolbarRow'
import { useKindFilterOrDefaults } from '@/providers/KindFilterProvider'
import { isWispTrendingNotesRelayUrl } from '@/lib/wisp-trending-relay'
import type { TPrimaryPageName } from '@/PageManager'
import { TFeedSubRequest, TNoteListMode } from '@/types'
import { cn } from '@/lib/utils'
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

const NormalFeed = forwardRef<TNoteListRef, {
  subRequests: TFeedSubRequest[]
  areAlgoRelays?: boolean
  /** When false, NoteList waits before opening timeline REQs (relay algo probe). */
  relayCapabilityReady?: boolean
  isMainFeed?: boolean
  /** When set (e.g. on Home), filter toolbar is rendered in layout subHeader instead of in-feed. */
  setSubHeader?: (node: React.ReactNode) => void
  /** Shown in the subHeader row beside the kind filter (mobile primary feed). */
  onSubHeaderRefresh?: () => void
  /**
   * When true with {@link mergeTimelineWhenSubRequestFiltersMatch}, relay URL list can change (e.g. favorites
   * hydrate after load) without clearing rows — same REQ shape, merge new stream into existing events.
   */
  preserveTimelineOnSubRequestsChange?: boolean
  mergeTimelineWhenSubRequestFiltersMatch?: boolean
  /** Home feed: widened relay stack (replies); Notes-only uses {@link subRequests}. */
  repliesSubRequests?: TFeedSubRequest[]
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
  /** Relay explore: explicit kinds EOSEd empty — parent widens to kindless `{ limit }` once. */
  onSingleRelayBrowseEmpty?: () => void
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
  /** Override default cap for merged one-shot batches (wide d-tag / search merges). */
  oneShotMergedCap?: number
  /** When every relay in the subscribe wave fails before EOSE, merge a one-shot fetch from default read relays (home multi-relay feeds). */
  timelinePublicReadFallback?: boolean
  /** When the feed is empty and terminal, {@link NoteList} can show an Alexandria search link (hashtag / d-tag pages). */
  alexandriaEmptyUrl?: string | null
  /**
   * Single-relay explore: only events from that relay's live REQ (no session/IDB prime, no prefetch to other relays).
   */
  relayAuthoritativeFeedOnly?: boolean
  /** Home favorites: favorites + trending relays for stats / "Seen on". */
  homeFeedSeenOnAllowlistOp?: string[]
  /** Home replies surface: adds NIP-65, cache, and HTTP index read relays. */
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
    onSingleRelayBrowseEmpty,
    feedTopNotice,
    oneShotFetch = false,
    progressiveWarmupQuery,
    progressiveWarmupMatch,
    progressiveDocumentKinds,
    oneShotAfterMergeComparator,
    extraShouldHideEvent,
    extraShouldHideRepliesEvent,
    oneShotMergedCap,
    timelinePublicReadFallback = false,
    alexandriaEmptyUrl = null,
    relayAuthoritativeFeedOnly = false,
    homeFeedSeenOnAllowlistOp,
    homeFeedSeenOnAllowlistReplies
  },
  ref
) {
  const { showKinds, showKind1OPs, showKind1Replies, showKind1111, feedKindFilterBypass } =
    useKindFilterOrDefaults()
  const internalNoteListRef = useRef<TNoteListRef>(null)
  const noteListRef = ref || internalNoteListRef
  const [feedFilterTabRowHost, setFeedFilterTabRowHost] = useState<HTMLDivElement | null>(null)
  const onFeedFilterTabRowSlotRef = useCallback((node: HTMLDivElement | null) => {
    setFeedFilterTabRowHost((prev) => (Object.is(prev, node) ? prev : node))
  }, [])

  /** Every shard URL is a nostrarchives Wisp "trending notes" stream — OP-only timeline. */
  const isWispTrendingOnlyFeed = useMemo(
    () =>
      subRequests.length > 0 &&
      subRequests.every(
        (req) => req.urls.length > 0 && req.urls.every((u) => isWispTrendingNotesRelayUrl(u))
      ),
    [subRequests]
  )

  /** Replies feed by default; Wisp trending stays notes-only. Kind filter can hide replies client-side. */
  const listMode: TNoteListMode = isWispTrendingOnlyFeed ? 'posts' : 'postsAndReplies'

  useEffect(() => {
    if (!isMainFeed) return
    if (storage.getNoteListMode() === listMode) return
    storage.setNoteListMode(listMode)
    window.dispatchEvent(new CustomEvent('noteListModeChanged'))
  }, [isMainFeed, listMode])

  const effectiveSubRequests = useMemo(() => {
    if (listMode === 'postsAndReplies' && repliesSubRequests) {
      return repliesSubRequests
    }
    return subRequests
  }, [listMode, subRequests, repliesSubRequests])

  const noteListExtraShouldHide = useMemo(() => {
    if (listMode === 'postsAndReplies') return extraShouldHideRepliesEvent
    return extraShouldHideEvent
  }, [listMode, extraShouldHideRepliesEvent, extraShouldHideEvent])

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

  const renderFilterToolbarInFeed = !(isMainFeed && setSubHeader)

  const filterToolbarRow = useMemo(
    () => (
      <FeedFilterToolbarRow
        showKinds={showKinds}
        onShowKindsChange={handleShowKindsChange}
        onRefresh={onSubHeaderRefresh}
        feedFilterTabRowSlotRef={onFeedFilterTabRowSlotRef}
        includeFeedSearchSlot={showFeedClientFilter}
      />
    ),
    [onSubHeaderRefresh, showKinds, handleShowKindsChange, showFeedClientFilter]
  )

  /**
   * Push the filter toolbar into {@link PrimaryPageLayout} subHeader. Use `useEffect` (not `useLayoutEffect`) so
   * parent `setHomeSubHeader` runs after paint; synchronous layout updates here caused React #185
   * (maximum update depth) when navigating onto the home feed after other primaries (e.g. notifications).
   * Intentionally omit `filterToolbarRow` from deps — covered by `subHeaderFilterDepsKey`.
   * Omit `onSubHeaderRefresh` / `onFeedFilterTabRowSlotRef`: only embedded in `filterToolbarRow`; unstable
   * identities there would retrigger every render and loop with parent state.
   * Do not clear subHeader between dep updates — nulling remounts the filter portal slot and retriggers
   * NoteList subscriptions / layout churn on the home feed.
   */
  useEffect(() => {
    if (!isMainFeed || !setSubHeader) return
    setSubHeader(<div className={feedFilterRowChromeClass}>{filterToolbarRow}</div>)
  }, [
    isMainFeed,
    setSubHeader,
    isWispTrendingOnlyFeed,
    subHeaderFilterDepsKey,
    allowKindlessRelayExplore
  ])

  useEffect(() => {
    if (!isMainFeed || !setSubHeader) return
    return () => setSubHeader(null)
  }, [isMainFeed, setSubHeader])

  return (
    <>
      {renderFilterToolbarInFeed ? (
        <div className={cn('sticky top-0 z-20', feedFilterRowChromeClass)}>{filterToolbarRow}</div>
      ) : null}
      <div className={cn('min-w-0', renderFilterToolbarInFeed ? 'pt-0' : 'pt-2')}>
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
          useFilterAsIs={useFilterAsIs}
          clientSideKindFilter={clientSideKindFilter}
          allowKindlessRelayExplore={allowKindlessRelayExplore}
          showAllKinds={listShowAllKinds}
          showFeedClientFilter={showFeedClientFilter}
          hostPrimaryPageName={hostPrimaryPageName}
          feedClientFilterTabRowHost={
            showFeedClientFilter ? feedFilterTabRowHost : undefined
          }
          onSingleRelayKindlessEmpty={onSingleRelayKindlessEmpty}
          onSingleRelayBrowseEmpty={onSingleRelayBrowseEmpty}
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
