import { RefreshButton } from '@/components/RefreshButton'
import { Button } from '@/components/ui/button'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import { useFeed } from '@/providers/FeedProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import type { TNoteListRef } from '@/components/NoteList'
import { NoteCardLoadingSkeleton } from '@/components/NoteCard'
import { TPageRef } from '@/types'
import { Calendar, Compass, Star, UsersRound } from 'lucide-react'
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import { FavoriteRelaysActiveStripMobileBar } from '@/components/FavoriteRelaysActiveStrip'
import FavoriteRelaysFeedPicker from '@/components/FavoriteRelaysFeedPicker'
import { ActiveRelaysTitlebarButton } from '@/components/ConnectedRelays/ActiveRelaysTitlebarButton'
import HelpAndAccountMenu from '@/components/HelpAndAccountMenu'
import Logo from '@/assets/Logo'
import RelaysFeed from './RelaysFeed'
import { usePrimaryPage } from '@/contexts/primary-page-context'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
const NoteListPage = forwardRef<TPageRef>((_, ref) => {
  const { t } = useTranslation()
  const { addRelayUrls, removeRelayUrls } = useCurrentRelays()
  const layoutRef = useRef<TPageRef>(null)
  const feedRef = useRef<TNoteListRef>(null)
  const { feedInfo, relayUrls, isReady } = useFeed()
  const { isSmallScreen } = useScreenSize()
  const [homeSubHeader, setHomeSubHeader] = useState<React.ReactNode>(null)

  const usesSubHeader =
    feedInfo.feedType === 'relay' ||
    feedInfo.feedType === 'relays' ||
    feedInfo.feedType === 'all-favorites'

  const runFeedRefresh = useCallback(() => {
    feedRef.current?.refresh()
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      scrollToTop: (behavior?: ScrollBehavior) => layoutRef.current?.scrollToTop(behavior),
      refresh: runFeedRefresh
    }),
    [runFeedRefresh]
  )

  const setHomeSubHeaderStable = useCallback((node: React.ReactNode) => {
    setHomeSubHeader(node)
  }, [])

  useEffect(() => {
    if (!usesSubHeader) setHomeSubHeader(null)
  }, [usesSubHeader])

  // REMOVED: Scroll-to-top logic - feed should NEVER scroll to top when drawer opens/closes
  // The feed stays mounted and maintains scroll position at all times

  useEffect(() => {
    if (relayUrls.length) {
      addRelayUrls(relayUrls)
      return () => {
        removeRelayUrls(relayUrls)
      }
    }
  }, [relayUrls])

  let content: React.ReactNode = null
  if (!isReady) {
    content = (
      <div
        className="min-h-[40vh] space-y-2 px-1 py-4"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <p className="px-3 text-sm text-muted-foreground">
          {t('feedStarting', {
            defaultValue: 'Starting feeds and relays… This can take a few seconds after login.'
          })}
        </p>
        {Array.from({ length: 5 }).map((_, i) => (
          <NoteCardLoadingSkeleton key={i} />
        ))}
      </div>
    )
  } else {
    content = (
      <>
        <RelaysFeed
          ref={feedRef}
          setSubHeader={setHomeSubHeaderStable}
          onSubHeaderRefresh={runFeedRefresh}
        />
      </>
    )
  }

  const showFavoriteRelaysPicker =
    isReady &&
    (feedInfo.feedType === 'all-favorites' ||
      feedInfo.feedType === 'relay' ||
      feedInfo.feedType === 'relays')

  const feedPageTitle = useMemo(
    () =>
      feedInfo.feedType === 'relays'
        ? t('relayType_relay_set')
        : t('Favorite Relays'),
    [feedInfo.feedType, t]
  )

  const subHeader = (
    <>
      {isSmallScreen ? <FavoriteRelaysActiveStripMobileBar /> : null}
      <div className="w-full min-w-0 border-b border-border/80 bg-background px-3 py-2 sm:px-4">
        <h1 className="app-chrome-title leading-tight tracking-tight">{feedPageTitle}</h1>
      </div>
      {showFavoriteRelaysPicker ? <FavoriteRelaysFeedPicker /> : null}
      {homeSubHeader}
    </>
  )

  /** Desktop: nav/logo/account live in titlebar only on small screens; refresh moves to subheader when present. Omit empty h-12 strip. */
  const showNoteListTitlebar =
    isSmallScreen ||
    !usesSubHeader ||
    (feedInfo.feedType === 'relay' && !!feedInfo.id)

  return (
    <PrimaryPageLayout
      pageName="feed"
      ref={layoutRef}
      suppressMobileDefaultActiveRelaysButton
      titlebar={
        showNoteListTitlebar ? (
          <NoteListPageTitlebar onFeedRefresh={runFeedRefresh} showTitlebarRefresh={!usesSubHeader} />
        ) : null
      }
      subHeader={subHeader}
      displayScrollToTopButton
    >
      <div className="min-w-0 pt-2">
        {content}
      </div>
    </PrimaryPageLayout>
  )
})
NoteListPage.displayName = 'NoteListPage'
export default NoteListPage

function NoteListPageTitlebar({
  onFeedRefresh,
  showTitlebarRefresh
}: {
  onFeedRefresh: () => void
  showTitlebarRefresh: boolean
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { navigate, current, currentPageProps, display } = usePrimaryPage()
  const { primaryViewType, setPrimaryNoteView } = usePrimaryNoteView()
  const { pubkey } = useNostr()
  const spell = (currentPageProps as { spell?: string } | undefined)?.spell
  const exploreActive = display && current === 'explore' && primaryViewType === null
  const followsLatestActive = display && current === 'follows-latest' && primaryViewType === null
  const favoritesActive =
    display && current === 'spells' && spell === 'favorites' && primaryViewType === null
  const calendarActive = display && current === 'calendar' && primaryViewType === null

  if (!isSmallScreen) {
    return (
      <div className="flex h-full w-full min-w-0 items-center justify-end gap-1 pr-1">
        {showTitlebarRefresh ? <RefreshButton onClick={onFeedRefresh} /> : null}
      </div>
    )
  }

  /**
   * Mobile: avoid absolutely centered logo (overlaps side controls on narrow widths). Three columns —
   * left/right hug content; center flexes so the banner shrinks. Overflow columns scroll if needed.
   */
  return (
    <div className="grid h-full w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-0.5 sm:gap-x-1">
      <div className="flex min-h-0 min-w-0 items-center justify-start gap-0.5 overflow-x-auto overflow-y-hidden scrollbar-hide sm:gap-1">
        <Button
          variant="ghost"
          size="titlebar-icon"
          title={t('Explore')}
          aria-label={t('Explore')}
          className={`shrink-0 ${exploreActive ? 'bg-accent/50' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            if (primaryViewType !== null) {
              setPrimaryNoteView(null)
            } else {
              navigate('explore')
            }
          }}
        >
          <Compass />
        </Button>
        {pubkey ? (
          <>
            <Button
              variant="ghost"
              size="titlebar-icon"
              title={t('Follows latest nav label')}
              aria-label={t('Follows latest nav label')}
              className={`shrink-0 ${followsLatestActive ? 'bg-accent/50' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                if (primaryViewType !== null) {
                  setPrimaryNoteView(null)
                }
                navigate('follows-latest')
              }}
            >
              <UsersRound />
            </Button>
            <Button
              variant="ghost"
              size="titlebar-icon"
              title={t('Favorites')}
              aria-label={t('Favorites')}
              className={`shrink-0 ${favoritesActive ? 'bg-accent/50' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                if (primaryViewType !== null) {
                  setPrimaryNoteView(null)
                }
                navigate('spells', { spell: 'favorites' })
              }}
            >
              <Star />
            </Button>
          </>
        ) : null}
      </div>
      <div className="flex min-h-0 min-w-0 items-center justify-center gap-0.5 px-0.5">
        <button
          type="button"
          className="flex min-h-8 min-w-0 max-w-full flex-1 cursor-pointer items-center justify-center overflow-hidden rounded-xl bg-card px-1 py-0.5 ring-1 ring-border/50 sm:px-1.5"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setPrimaryNoteView(null)
          }}
          aria-label="Imwald"
        >
          <Logo className="max-h-7 w-full min-w-0 object-contain object-center sm:max-h-8" />
        </button>
        <Button
          variant="ghost"
          size="titlebar-icon"
          className={`shrink-0 ${calendarActive ? 'bg-accent/50' : ''}`}
          title={t('Calendar')}
          aria-label={t('Calendar')}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (primaryViewType !== null) {
              setPrimaryNoteView(null)
            }
            navigate('calendar')
          }}
        >
          <Calendar />
        </Button>
      </div>
      <div className="flex min-h-0 min-w-0 items-center justify-end gap-0.5 overflow-x-auto overflow-y-hidden scrollbar-hide sm:gap-1">
        {showTitlebarRefresh ? <RefreshButton onClick={onFeedRefresh} /> : null}
        <ActiveRelaysTitlebarButton />
        <HelpAndAccountMenu variant="titlebar" />
      </div>
    </div>
  )
}

