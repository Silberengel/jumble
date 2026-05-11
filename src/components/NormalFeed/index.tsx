import NoteList, { TNoteListRef } from '@/components/NoteList'
import { RefreshButton } from '@/components/RefreshButton'
import Tabs, { TabDefinition } from '@/components/Tabs'
import { useKindFilterOrDefaults } from '@/providers/KindFilterProvider'
import { useUserTrust } from '@/contexts/user-trust-context'
import storage from '@/services/local-storage.service'
import { PROFILE_MEDIA_TAB_KINDS, FAST_READ_RELAY_URLS } from '@/constants'
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
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import KindFilter from '../KindFilter'

/**
 * Home Gallery: favorites (or chip relays) first, then {@link FAST_READ_RELAY_URLS} so NIP-71 / picture / voice
 * events are not starved when the user’s relay set is mostly text timelines. Deduped by normalized URL.
 */
function galleryRelayUrlsMergedWithReadLayer(favoriteUrls: readonly string[]): string[] {
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
  for (const u of FAST_READ_RELAY_URLS) add(u)
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
  /** Override default cap for merged one-shot batches (wide d-tag / search merges). */
  oneShotMergedCap?: number
  /** When every relay in the subscribe wave fails before EOSE, merge a one-shot fetch from default read relays (home multi-relay feeds). */
  timelinePublicReadFallback?: boolean
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
    oneShotMergedCap,
    timelinePublicReadFallback = false
  },
  ref
) {
  const { hideUntrustedNotes } = useUserTrust()
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

  const MEDIA_KINDS = useMemo(() => [...PROFILE_MEDIA_TAB_KINDS], [])

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

  /** Replies may widen relays; Gallery only swaps kinds and widens relays when the caller opts in. */
  const effectiveSubRequests = useMemo(() => {
    if (listMode === 'postsAndReplies' && repliesSubRequests) {
      return repliesSubRequests
    }
    if (listMode !== 'media') return subRequests
    return subRequests.map((req) => ({
      ...req,
      urls: isMainFeed && widenMainGalleryRelays ? galleryRelayUrlsMergedWithReadLayer(req.urls) : req.urls,
      filter: { ...req.filter, kinds: MEDIA_KINDS }
    }))
  }, [listMode, subRequests, repliesSubRequests, MEDIA_KINDS, isMainFeed, widenMainGalleryRelays])

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
   * Relay explorer passes {@link showAllKinds} explicitly. Home feeds must not tie this to
   * {@link feedKindFilterBypass}: bypass widens REQ only; the kind picker still narrows visible rows.
   */
  const listShowAllKinds = showAllKindsProp ?? false

  /** Include kind picker deps for single-relay chips (kindless REQ + client-side kinds). */
  const subHeaderFilterDepsKey = `${allowKindlessRelayExplore ? 'kle' : 'std'}|${showKindsKey}|${feedKindFilterBypass}|${showAllKindsProp ? 'allProp' : 'k'}`

  /** Notes / Replies / Gallery switch, plus refresh + kind filter — on Wisp trending only the tool row (no mode tabs). */
  const tabsElement = useMemo(() => {
    const kindRowOptions = (
      <div className="flex items-center gap-1">
        {onSubHeaderRefresh != null && <RefreshButton onClick={onSubHeaderRefresh} />}
        <KindFilter showKinds={showKinds} onShowKindsChange={handleShowKindsChange} />
      </div>
    )
    if (isMainFeed && isWispTrendingOnlyFeed) {
      return (
        <div className="flex w-full min-w-0 items-center justify-end gap-1 py-1">{kindRowOptions}</div>
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
    handleShowKindsChange
  ])

  const renderTabsInFeed = !(isMainFeed && setSubHeader) && !allowKindlessRelayExplore

  const mergeFilterWithTabsRow =
    showFeedClientFilter && ((isMainFeed && !!setSubHeader) || renderTabsInFeed)

  /** Same row for multi-relay and single-relay chips: Notes/Replies + refresh + kind picker (REQ may stay kindless for single relay; NoteList filters client-side). */
  useLayoutEffect(() => {
    if (!isMainFeed || !setSubHeader) return
    if (mergeFilterWithTabsRow) {
      setSubHeader(
        <div className="flex w-full min-w-0 flex-wrap items-end gap-x-2 gap-y-1 border-b border-border/80 bg-background/95 pb-1.5 pt-0.5 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="min-w-0 flex-1">{tabsElement}</div>
          <div
            ref={onFeedFilterTabRowSlotRef}
            className="flex shrink-0 flex-col items-end justify-center self-center"
          />
        </div>
      )
    } else {
      setSubHeader(tabsElement)
    }
    return () => setSubHeader(null)
    // Intentionally omit `tabsElement`: same semantics are covered by listMode + subHeaderFilterDepsKey.
    // Listing tabsElement here can retrigger the effect every render if its useMemo input references churn,
    // which calls setSubHeader repeatedly → parent state → maximum update depth (#185).
  }, [
    isMainFeed,
    setSubHeader,
    listMode,
    isWispTrendingOnlyFeed,
    subHeaderFilterDepsKey,
    onSubHeaderRefresh,
    allowKindlessRelayExplore,
    mergeFilterWithTabsRow,
    onFeedFilterTabRowSlotRef
  ])

  return (
    <>
      {renderTabsInFeed &&
        (mergeFilterWithTabsRow ? (
          <div className="sticky top-0 z-20 border-b border-border/80 bg-background/95 pb-1.5 pt-0.5 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div className="flex w-full min-w-0 flex-wrap items-end gap-x-2 gap-y-1">
              <div className="min-w-0 flex-1">{tabsElement}</div>
              <div
                ref={onFeedFilterTabRowSlotRef}
                className="flex shrink-0 flex-col items-end justify-center self-center"
              />
            </div>
          </div>
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
          hideUntrustedNotes={hideUntrustedNotes}
          areAlgoRelays={areAlgoRelays}
          relayCapabilityReady={relayCapabilityReady}
          feedSubscriptionKey={feedSubscriptionKey}
          preserveTimelineOnSubRequestsChange={preserveTimelineOnSubRequestsChange}
          mergeTimelineWhenSubRequestFiltersMatch={mergeTimelineWhenSubRequestFiltersMatch}
          followingFeedDeltaSubRequests={followingFeedDeltaSubRequests}
          feedTimelineScopeKey={feedTimelineScopeKey}
          homeFeedListMode={isMainFeed ? listMode : undefined}
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
          extraShouldHideEvent={
            listMode === 'postsAndReplies'
              ? extraShouldHideRepliesEvent
              : extraShouldHideEvent
          }
          oneShotMergedCap={oneShotMergedCap}
          timelinePublicReadFallback={timelinePublicReadFallback && listMode === 'postsAndReplies'}
        />
      </div>
    </>
  )
})

export default NormalFeed
