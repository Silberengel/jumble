import { RefreshButton } from '@/components/RefreshButton'
import { Button } from '@/components/ui/button'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import { useFeed } from '@/providers/feed-context'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { normalizeUrl } from '@/lib/url'
import type { TNoteListRef } from '@/components/NoteList'
import { TPageRef } from '@/types'
import { Calendar, Compass, Flame } from 'lucide-react'
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
import Logo from '@/assets/Logo'
import { DiscussionsTitlebarButton } from '@/components/Sidebar/DiscussionsButton'
import { LibraryTitlebarButton } from '@/components/Sidebar/LibraryButton'
import RelaysFeed from './RelaysFeed'
import { usePrimaryPage } from '@/contexts/primary-page-context'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
const NoteListPage = forwardRef<TPageRef>((_, ref) => {
  const { t } = useTranslation()
  const { addRelayUrls, removeRelayUrls } = useCurrentRelays()
  const layoutRef = useRef<TPageRef>(null)
  const feedRef = useRef<TNoteListRef>(null)
  const { relayUrls } = useFeed()
  const relayUrlsKey = useMemo(
    () =>
      [...relayUrls]
        .map((u) => normalizeUrl(u) || u)
        .filter(Boolean)
        .sort()
        .join('|'),
    [relayUrls]
  )
  const { isSmallScreen } = useScreenSize()
  const [homeSubHeader, setHomeSubHeader] = useState<React.ReactNode>(null)

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

  // REMOVED: Scroll-to-top logic - feed should NEVER scroll to top when drawer opens/closes
  // The feed stays mounted and maintains scroll position at all times

  useEffect(() => {
    const urls = relayUrlsKey.split('|').filter(Boolean)
    if (!urls.length) return
    addRelayUrls(urls)
    return () => {
      removeRelayUrls(urls)
    }
  }, [relayUrlsKey, addRelayUrls, removeRelayUrls])

  const feedPageTitle = t('Favorite Relays')

  const subHeader = (
    <>
      <div className="w-full min-w-0 border-b border-border/80 bg-background px-3 py-2.5 sm:px-4 sm:py-3">
        <h1 className="app-chrome-title leading-tight tracking-tight">{feedPageTitle}</h1>
      </div>
      {homeSubHeader}
    </>
  )

  /** Desktop: nav/logo/account live in titlebar only on small screens; refresh moves to subheader when present. Omit empty h-12 strip. */
  const showNoteListTitlebar = isSmallScreen

  return (
    <PrimaryPageLayout
      pageName="feed"
      ref={layoutRef}
      titlebar={
        showNoteListTitlebar ? (
          <NoteListPageTitlebar onFeedRefresh={runFeedRefresh} showTitlebarRefresh={false} />
        ) : null
      }
      subHeader={subHeader}
      displayScrollToTopButton
    >
      <div className="min-w-0 pt-2">
        <RelaysFeed
          ref={feedRef}
          setSubHeader={setHomeSubHeaderStable}
          onSubHeaderRefresh={runFeedRefresh}
        />
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
  const heatMapActive =
    display && current === 'spells' && spell === 'heatMap' && primaryViewType === null
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
          <Button
            variant="ghost"
            size="titlebar-icon"
            title={t('Heat map')}
            aria-label={t('Heat map')}
            className={`shrink-0 ${heatMapActive ? 'bg-accent/50' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              if (primaryViewType !== null) {
                setPrimaryNoteView(null)
              }
              navigate('spells', { spell: 'heatMap' })
            }}
          >
            <Flame />
          </Button>
        ) : null}
        <LibraryTitlebarButton />
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
        <DiscussionsTitlebarButton />
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
      </div>
    </div>
  )
}

