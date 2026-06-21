import NoteCard, { NoteCardLoadingSkeleton } from '@/components/NoteCard'
import FeedFilterToolbarRow, { feedFilterRowChromeClass } from '@/components/FeedFilterToolbarRow'
import type { TNoteListRef } from '@/components/NoteList'
import { Button } from '@/components/ui/button'
import { useFeedProfileBatchFromEvents } from '@/hooks/useFeedProfileBatchFromEvents'
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
  useRef
} from 'react'
import { useTranslation } from 'react-i18next'
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
  const { relayUrls, homeFeedRelaySource } = useFeed()
  const { showKinds, feedKindFilterBypass } = useKindFilterOrDefaults()
  const filterMutedNotes = true
  const feedRootRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRootRef = useRef<HTMLElement | Window | null>(null)

  const {
    bundle,
    visibleEvents,
    loading,
    loadingMore,
    hasMore,
    pendingNewCount,
    listMode,
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
        const root = scrollRootRef.current ?? getNearestScrollableAncestor(feedRootRef.current)
        if (root && root !== window) {
          ;(root as HTMLElement).scrollTo({ top: 0, behavior: behavior ?? 'smooth' })
        } else {
          window.scrollTo({ top: 0, behavior: behavior ?? 'smooth' })
        }
        flushPendingNew()
      },
      refresh
    }),
    [refresh, flushPendingNew]
  )

  const showKindsKey = useMemo(() => JSON.stringify(showKinds), [showKinds])

  const feedRelayUrls = useMemo(() => {
    if (homeFeedRelaySource === HOME_FEED_RELAY_SOURCE_FAVORITES) {
      return ensureHomeFeedTrendingRelay(relayUrls)
    }
    return relayUrls
  }, [homeFeedRelaySource, relayUrls])

  const handleShowKindsChange = useCallback((_newShowKinds: number[]) => {
    const root = scrollRootRef.current ?? getNearestScrollableAncestor(feedRootRef.current)
    if (root && root !== window) {
      ;(root as HTMLElement).scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [])

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
    scrollRootRef.current = root

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

  if (!bundle) {
    return (
      <div className="min-h-[20vh] space-y-2 px-1 py-4" role="status" aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <NoteCardLoadingSkeleton key={i} />
        ))}
      </div>
    )
  }

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

      {visibleEvents.length === 0 && !loading ? (
        <div className="px-2 py-8 text-center text-sm text-muted-foreground">
          {t('No posts found')}
        </div>
      ) : null}

      {visibleEvents.map((event) => (
        <NoteCard
          key={event.id}
          className="w-full"
          event={event}
          filterMutedNotes={filterMutedNotes}
          deferAuthorAvatar
          hideEngagementChrome
          seenOnAllowlist={seenOnAllowlist}
        />
      ))}

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
