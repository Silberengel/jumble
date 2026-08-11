import NoteCard, { NoteCardLoadingSkeleton } from '@/components/NoteCard'
import FeedFilterToolbarRow, { feedFilterRowChromeClass } from '@/components/FeedFilterToolbarRow'
import type { TNoteListRef } from '@/components/NoteList'
import { VirtualizedEventList } from '@/components/VirtualizedEventList'
import { Button } from '@/components/ui/button'
import { useFeedProfileBatchFromEvents } from '@/hooks/useFeedProfileBatchFromEvents'
import { uniqueRelayUrlsFromSubRequests } from '@/lib/feed-relay-urls'
import { HOME_FEED_RELAY_SOURCE_FAVORITES } from '@/lib/home-feed-relay-source'
import { ensureHomeFeedTrendingRelay } from '@/lib/home-feed-relays'
import { useKindFilterOrDefaults } from '@/providers/KindFilterProvider'
import { useFeed } from '@/providers/feed-context'
import { cn } from '@/lib/utils'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  HOME_FEED_VIRTUAL_ESTIMATE_SIZE_PX,
  HOME_FEED_VIRTUAL_OVERSCAN
} from './constants'
import { useHomeFeed } from './useHomeFeed'

const LOAD_MORE_ROOT_MARGIN_BOTTOM_PX = 800
const SCROLL_TOP_THRESHOLD_PX = 120

function getNearestScrollableAncestor(node: HTMLElement | null): HTMLElement | null {
  if (!node) return null
  let el: HTMLElement | null = node.parentElement
  while (el && el !== document.documentElement) {
    const { overflowY } = getComputedStyle(el)
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return el
    el = el.parentElement
  }
  return null
}

const HomeFeed = forwardRef<
  TNoteListRef,
  {
    setSubHeader?: (node: React.ReactNode) => void
    onSubHeaderRefresh?: () => void
  }
>(function HomeFeed({ setSubHeader, onSubHeaderRefresh }, ref) {
  const { t } = useTranslation()
  const { relayUrls, replyRelayUrls, homeFeedRelaySource } = useFeed()
  const { showKinds, feedKindFilterBypass } = useKindFilterOrDefaults()
  const filterMutedNotes = true
  const feedRootRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [scrollElement, setScrollElement] = useState<HTMLElement | Window | null>(null)

  const {
    bundle,
    visibleEvents,
    loading,
    loadingMore,
    hasMore,
    pendingNewCount,
    listMode,
    relayOutcomes,
    emptyUiReady,
    loadMore,
    refresh,
    flushPendingNew,
    setScrolledFromTop
  } = useHomeFeed()

  const { contextValue: feedProfileContextValue, Provider: FeedProfileProvider } =
    useFeedProfileBatchFromEvents(visibleEvents)

  useImperativeHandle(
    ref,
    () => ({
      scrollToTop: (behavior?: ScrollBehavior) => {
        const root = scrollElement ?? getNearestScrollableAncestor(feedRootRef.current)
        if (root && root !== window) {
          ;(root as HTMLElement).scrollTo({ top: 0, behavior: behavior ?? 'smooth' })
        } else {
          window.scrollTo({ top: 0, behavior: behavior ?? 'smooth' })
        }
        flushPendingNew()
      },
      refresh
    }),
    [refresh, flushPendingNew, scrollElement]
  )

  const showKindsKey = useMemo(() => JSON.stringify(showKinds), [showKinds])

  const feedRelayUrls = useMemo(() => {
    const urls = bundle?.activeSubRequests?.length
      ? uniqueRelayUrlsFromSubRequests(bundle.activeSubRequests)
      : replyRelayUrls.length > 0
        ? replyRelayUrls
        : relayUrls
    if (homeFeedRelaySource === HOME_FEED_RELAY_SOURCE_FAVORITES) {
      return ensureHomeFeedTrendingRelay(urls)
    }
    return urls
  }, [bundle, homeFeedRelaySource, relayUrls, replyRelayUrls])

  const handleShowKindsChange = useCallback((_newShowKinds: number[]) => {
    const root = scrollElement ?? getNearestScrollableAncestor(feedRootRef.current)
    if (root && root !== window) {
      ;(root as HTMLElement).scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [scrollElement])

  const filterToolbarRow = useMemo(
    () => (
      <FeedFilterToolbarRow
        showKinds={showKinds}
        onShowKindsChange={handleShowKindsChange}
        onRefresh={onSubHeaderRefresh}
        relayUrls={feedRelayUrls}
      />
    ),
    [feedRelayUrls, onSubHeaderRefresh, showKinds, handleShowKindsChange]
  )

  useEffect(() => {
    if (!setSubHeader) return
    setSubHeader(<div className={feedFilterRowChromeClass}>{filterToolbarRow}</div>)
  }, [setSubHeader, showKindsKey, feedKindFilterBypass, filterToolbarRow])

  useEffect(() => {
    if (!setSubHeader) return
    return () => setSubHeader(null)
  }, [setSubHeader])

  useEffect(() => {
    const anchor = feedRootRef.current
    if (!anchor) return
    const root = getNearestScrollableAncestor(anchor) ?? window
    setScrollElement(root)

    const onScroll = () => {
      const top =
        root === window
          ? window.scrollY
          : (root as HTMLElement).scrollTop
      setScrolledFromTop(top > SCROLL_TOP_THRESHOLD_PX)
    }

    root.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => root.removeEventListener('scroll', onScroll)
  }, [setScrolledFromTop])

  useEffect(() => {
    const node = bottomRef.current
    if (!node) return
    const root = getNearestScrollableAncestor(feedRootRef.current)
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || loading || loadingMore) return
        if (hasMore) loadMore()
      },
      {
        root,
        rootMargin: `0px 0px ${LOAD_MORE_ROOT_MARGIN_BOTTOM_PX}px 0px`,
        threshold: 0
      }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, loading, loadingMore, loadMore])

  const hideReplies = listMode === 'posts'
  const seenOnAllowlist =
    hideReplies || bundle?.relaySetFeedOnly
      ? bundle?.seenOnAllowlistOp
      : bundle?.seenOnAllowlistReplies

  const relayStatusHint = useMemo(() => {
    if (!emptyUiReady || visibleEvents.length > 0 || loading) return null
    if (relayOutcomes.length === 0) return null
    const authOrCooldown = relayOutcomes.filter((r) => {
      const d = (r.detail ?? '').toLowerCase()
      return (
        r.outcome === 'timeout' ||
        r.outcome === 'closed' ||
        d.includes('auth') ||
        d.includes('rate') ||
        d.includes('cooldown')
      )
    })
    if (authOrCooldown.length === 0) return null
    if (authOrCooldown.length >= relayOutcomes.length) {
      return t('Waiting on relays…')
    }
    return t('Some relays are slow or cooling down…')
  }, [emptyUiReady, visibleEvents.length, loading, relayOutcomes, t])

  const renderEvent = useCallback(
    (event: (typeof visibleEvents)[number]) => (
      <NoteCard
        className="w-full"
        event={event}
        filterMutedNotes={filterMutedNotes}
        deferAuthorAvatar
        hideEngagementChrome
        seenOnAllowlist={seenOnAllowlist}
      />
    ),
    [filterMutedNotes, seenOnAllowlist]
  )

  if (!bundle) {
    return (
      <div className="min-h-[20vh] space-y-2 px-1 py-4" role="status" aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <NoteCardLoadingSkeleton key={i} />
        ))}
      </div>
    )
  }

  const showEmpty =
    visibleEvents.length === 0 && !loading && emptyUiReady

  return (
    <FeedProfileProvider value={feedProfileContextValue}>
    <div ref={feedRootRef} className="min-w-0 pt-2">
      {pendingNewCount > 0 ? (
        <div className="sticky top-0 z-30 flex justify-center py-2">
          <Button type="button" size="sm" variant="secondary" onClick={flushPendingNew}>
            {t('{{count}} new notes', { count: pendingNewCount })}
          </Button>
        </div>
      ) : null}

      {showEmpty ? (
        <div className="px-2 py-8 text-center text-sm text-muted-foreground">
          {relayStatusHint ?? t('No posts found')}
        </div>
      ) : null}

      {visibleEvents.length > 0 && scrollElement ? (
        <VirtualizedEventList
          events={visibleEvents}
          estimateSize={HOME_FEED_VIRTUAL_ESTIMATE_SIZE_PX}
          overscan={HOME_FEED_VIRTUAL_OVERSCAN}
          scrollElement={scrollElement}
          renderEvent={renderEvent}
        />
      ) : visibleEvents.length > 0 ? (
        visibleEvents.map((event) => (
          <NoteCard
            key={event.id}
            className="w-full"
            event={event}
            filterMutedNotes={filterMutedNotes}
            deferAuthorAvatar
            hideEngagementChrome
            seenOnAllowlist={seenOnAllowlist}
          />
        ))
      ) : null}

      {loading || loadingMore ? (
        <div className="min-h-[20vh] space-y-2 px-1 py-4" role="status" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <NoteCardLoadingSkeleton key={i} />
          ))}
        </div>
      ) : null}

      <div ref={bottomRef} className={cn('h-4 w-full shrink-0', !hasMore && 'hidden')} aria-hidden />
    </div>
    </FeedProfileProvider>
  )
})

HomeFeed.displayName = 'HomeFeed'
export default HomeFeed
