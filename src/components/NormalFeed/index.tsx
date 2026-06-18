import NoteList, { TNoteListRef } from '@/components/NoteList'
import FeedFilterToolbarRow, { feedFilterRowChromeClass } from '@/components/FeedFilterToolbarRow'
import { useKindFilterOrDefaults } from '@/providers/KindFilterProvider'
import { isWispTrendingNotesRelayUrl } from '@/lib/wisp-trending-relay'
import type { TPrimaryPageName } from '@/PageManager'
import { TFeedSubRequest } from '@/types'
import { cn } from '@/lib/utils'
import type { Event } from 'nostr-tools'
import {
  forwardRef,
  useCallback,
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
  /** Shown in the subHeader row beside the kind filter (mobile primary feed). */
  feedTimelineScopeKey?: string
  /** Single-relay Explore / chip: kindless REQ (see `SINGLE_RELAY_KINDLESS_REQ_LIMIT` in constants). */
  useFilterAsIs?: boolean
  clientSideKindFilter?: boolean
  allowKindlessRelayExplore?: boolean
  /**
   * Default true (relay explore): kind picker narrows visible rows.
   * Ignored when {@link showAllKinds} is effectively true.
   */
  withKindFilter?: boolean
  /**
   * When true (relay explorer page), list shows the full relay batch. When omitted, uses KindFilter "All Events"
   * ({@link useKindFilterOrDefaults} / persisted bypass).
   */
  showAllKinds?: boolean
  /**
   * Client-side 🔍 feed filter. When omitted: shown on relay explore and non-main feeds.
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
  /** When every relay in the subscribe wave fails before EOSE, merge a one-shot fetch from default read relays. */
  timelinePublicReadFallback?: boolean
  /** When the feed is empty and terminal, {@link NoteList} can show an Alexandria search link (hashtag / d-tag pages). */
  alexandriaEmptyUrl?: string | null
  /**
   * Single-relay explore: only events from that relay's live REQ (no session/IDB prime, no prefetch to other relays).
   */
  relayAuthoritativeFeedOnly?: boolean
  /** Optional override for stats + ⋯ “Seen on” relay allowlist. */
  seenOnAllowlist?: readonly string[]
}>(function NormalFeed(
  {
    subRequests,
    areAlgoRelays = false,
    relayCapabilityReady = true,
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
    seenOnAllowlist
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

  const noteListExtraShouldHide = isWispTrendingOnlyFeed
    ? extraShouldHideEvent
    : (extraShouldHideRepliesEvent ?? extraShouldHideEvent)

  const handleShowKindsChange = useCallback((_newShowKinds: number[]) => {
    if (noteListRef && typeof noteListRef !== 'function') {
      noteListRef.current?.scrollToTop()
    }
  }, [noteListRef])

  const showFeedClientFilter = showFeedClientFilterProp ?? true

  const listShowAllKinds = showAllKindsProp ?? feedKindFilterBypass

  const filterToolbarRow = useMemo(
    () => (
      <FeedFilterToolbarRow
        showKinds={showKinds}
        onShowKindsChange={handleShowKindsChange}
        feedFilterTabRowSlotRef={onFeedFilterTabRowSlotRef}
        includeFeedSearchSlot={showFeedClientFilter}
      />
    ),
    [showKinds, handleShowKindsChange, showFeedClientFilter]
  )

  return (
    <>
      <div className={cn('sticky top-0 z-20', feedFilterRowChromeClass)}>{filterToolbarRow}</div>
      <div className="min-w-0 pt-0">
        <NoteList
          ref={noteListRef}
          showKinds={showKinds}
          showKind1OPs={showKind1OPs}
          showKind1Replies={showKind1Replies}
          showKind1111={showKind1111}
          seeAllFeedEvents={feedKindFilterBypass}
          withKindFilter={withKindFilter}
          subRequests={subRequests}
          hideReplies={isWispTrendingOnlyFeed}
          areAlgoRelays={areAlgoRelays}
          relayCapabilityReady={relayCapabilityReady}
          feedTimelineScopeKey={feedTimelineScopeKey}
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
          timelinePublicReadFallback={timelinePublicReadFallback}
          alexandriaEmptyUrl={alexandriaEmptyUrl}
          relayAuthoritativeFeedOnly={relayAuthoritativeFeedOnly}
          seenOnAllowlist={seenOnAllowlist}
        />
      </div>
    </>
  )
})

export default NormalFeed
