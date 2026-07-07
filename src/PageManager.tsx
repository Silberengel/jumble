// This file exports both React components and hooks alongside inline JSX in callbacks,
// making it incompatible with Vite's Fast Refresh auto-detection. Opting into explicit
// full-reload mode to suppress the "incompatible export" HMR warning.
// @refresh reset
import { RefreshButton } from '@/components/RefreshButton'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import logger from '@/lib/logger'
import {
  captureMobilePrimaryFeedScroll,
  peekMobilePrimaryFeedScroll
} from '@/lib/mobile-primary-feed-scroll'
import { useMobileSwipeBackOnElement } from '@/lib/mobile-swipe-back'
import { ChevronLeft } from 'lucide-react'
import { NavigationService } from '@/services/navigation.service'
// Page imports needed for primary note view
import { ImwaldBrandBar } from '@/assets/Logo'
import LiveActivitiesStrip from '@/components/LiveActivitiesStrip'
import { APP_RESET_TO_LANDING_EVENT, PROFILE_SECONDARY_PANEL_DEFER_MS } from '@/constants'
import { extendProfileNetworkDeferral } from '@/lib/profile-batch-coordinator'
import client from '@/services/client.service'
import noteStatsService from '@/services/note-stats.service'
import { navigationEventStore } from '@/services/navigation-event-store'
import { CurrentRelaysProvider } from '@/providers/CurrentRelaysProvider'
import { TPageRef } from '@/types'
import {
  cloneElement,
  createRef,
  isValidElement,
  lazy,
  type ReactElement,
  type ReactNode,
  RefObject,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useEventCallback } from '@/hooks/use-event-callback'
import { useTranslation } from 'react-i18next'
import { KeyboardShortcutsHelpProvider } from '@/components/KeyboardShortcutsHelp'
import {
  PrimaryPageContext,
  usePrimaryPage,
  usePrimaryPageOptional,
  type PrimaryPageContextValue
} from '@/contexts/primary-page-context'
import {
  applyRouteDocumentMeta,
  isNoteDetailPathname,
  isProfileDetailPathname
} from '@/lib/document-meta'
import { normalizeUrl } from './lib/url'
import modalManager from './services/modal-manager.service'
import { decodeRssArticlePathSegment, encodeRssArticlePathSegment } from '@/lib/rss-article'
import { matchAppRoute } from './routes'
import { useScreenSize, useScreenSizeOptional } from './providers/ScreenSizeProvider'
import {
  PrimaryNoteViewContext,
  usePrimaryNoteView,
  usePrimaryNoteViewOptional,
  type TPrimaryOverlayViewType
} from '@/contexts/primary-note-view-context'
import { SecondaryPageContext, useSecondaryPage, useSecondaryPageOptional, type SecondaryPageContextValue } from '@/contexts/secondary-page-context'

/** Survives React StrictMode remount so initial URL → secondary stack is not built twice. */
let historyLocationSeedApplied = false

/** Lazy-loaded so PageManager does not synchronously import SpellsPage (avoids HMR cycle: SpellsPage → PrimaryPageLayout → PageManager → SpellsPage). */
const SpellsPageLazy = lazy(() => import('./pages/primary/SpellsPage'))
/** Lazy NoteList pages break: PageManager → … → NoteList → NoteCard → useSmartNoteNavigation → PageManager */
const NoteListPageLazy = lazy(() => import('@/pages/primary/NoteListPage'))

const primaryPageLazyFallback = (
  <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
    Loading…
  </div>
)

/** Lazy primary pages: each may import PrimaryPageLayout → usePrimaryPage → would sync-import PageManager. */
const ExplorePageLazy = lazy(() => import('./pages/primary/ExplorePage'))
const MePageLazy = lazy(() => import('./pages/primary/MePage'))
const ProfilePageLazy = lazy(() => import('./pages/primary/ProfilePage'))
const RelayPageLazy = lazy(() => import('./pages/primary/RelayPage'))
const SearchPageLazy = lazy(() => import('./pages/primary/SearchPage'))
const LibraryPageLazy = lazy(() => import('./pages/primary/LibraryPage'))
const SettingsPrimaryPageLazy = lazy(() => import('./pages/primary/SettingsPrimaryPage'))
const CalendarPrimaryPageLazy = lazy(() => import('./pages/primary/CalendarPrimaryPage'))

/** Lazy chrome: Sidebar / bottom bar / dialogs import hooks from PageManager — must not be sync-imported here. */
const SidebarLazy = lazy(() => import('@/components/Sidebar'))
const BottomNavigationBarLazy = lazy(() => import('@/components/BottomNavigationBar'))
const TooManyRelaysAlertDialogLazy = lazy(() => import('@/components/TooManyRelaysAlertDialog'))
const PostSignupBackupRedirectLazy = lazy(() => import('@/components/PostSignupBackupRedirect'))

/** Mobile primary-note overlay: lazy so these pages are not in the main bundle (routes use the same modules → shared async chunks). */
const SecondaryProfilePageLazy = lazy(() => import('@/pages/secondary/ProfilePage'))
const PrimaryFollowingListPageLazy = lazy(() => import('@/pages/secondary/FollowingListPage'))
const PrimaryFollowersListPageLazy = lazy(() => import('@/pages/secondary/FollowersListPage'))
const PrimaryMuteListPageLazy = lazy(() => import('@/pages/secondary/MuteListPage'))
const PrimaryBookmarkListPageLazy = lazy(() => import('@/pages/secondary/BookmarkListPage'))
const PrimaryNotificationThreadFollowListPageLazy = lazy(() =>
  import('@/pages/secondary/NotificationThreadWatchListPage').then((m) => ({
    default: m.NotificationThreadFollowListPage
  }))
)
const PrimaryNotificationThreadMuteListPageLazy = lazy(() =>
  import('@/pages/secondary/NotificationThreadWatchListPage').then((m) => ({
    default: m.NotificationThreadMuteListPage
  }))
)
const PrimaryPinListPageLazy = lazy(() => import('@/pages/secondary/PinListPage'))
const PrimaryProfileBadgesListPageLazy = lazy(() => import('@/pages/secondary/ProfileBadgesListPage'))
const PrimaryInterestListPageLazy = lazy(() => import('@/pages/secondary/InterestListPage'))
const PrimaryUserEmojiListPageLazy = lazy(() => import('@/pages/secondary/UserEmojiListPage'))
const PrimaryOthersRelaySettingsPageLazy = lazy(() => import('@/pages/secondary/OthersRelaySettingsPage'))

function suspensePrimaryPage(page: ReactElement) {
  return <Suspense fallback={primaryPageLazyFallback}>{page}</Suspense>
}

type TStackItem = {
  index: number
  url: string
  component: React.ReactElement | null
  ref: RefObject<TPageRef> | null
}

const PRIMARY_PAGE_REF_MAP = {
  explore: createRef<TPageRef>(),
  feed: createRef<TPageRef>(),
  me: createRef<TPageRef>(),
  profile: createRef<TPageRef>(),
  relay: createRef<TPageRef>(),
  search: createRef<TPageRef>(),
  library: createRef<TPageRef>(),
  settings: createRef<TPageRef>(),
  spells: createRef<TPageRef>(),
  calendar: createRef<TPageRef>()
}

// Lazy function to create PRIMARY_PAGE_MAP to avoid circular dependency
// This is only evaluated when called, not at module load time
const getPrimaryPageMap = () => ({
  explore: (
    <Suspense fallback={primaryPageLazyFallback}>
      <ExplorePageLazy ref={PRIMARY_PAGE_REF_MAP.explore} />
    </Suspense>
  ),
  feed: (
    <Suspense fallback={primaryPageLazyFallback}>
      <NoteListPageLazy ref={PRIMARY_PAGE_REF_MAP.feed} />
    </Suspense>
  ),
  me: (
    <Suspense fallback={primaryPageLazyFallback}>
      <MePageLazy ref={PRIMARY_PAGE_REF_MAP.me} />
    </Suspense>
  ),
  profile: (
    <Suspense fallback={primaryPageLazyFallback}>
      <ProfilePageLazy ref={PRIMARY_PAGE_REF_MAP.profile} />
    </Suspense>
  ),
  relay: (
    <Suspense fallback={primaryPageLazyFallback}>
      <RelayPageLazy ref={PRIMARY_PAGE_REF_MAP.relay} />
    </Suspense>
  ),
  search: (
    <Suspense fallback={primaryPageLazyFallback}>
      <SearchPageLazy ref={PRIMARY_PAGE_REF_MAP.search} />
    </Suspense>
  ),
  library: (
    <Suspense fallback={primaryPageLazyFallback}>
      <LibraryPageLazy ref={PRIMARY_PAGE_REF_MAP.library} />
    </Suspense>
  ),
  settings: (
    <Suspense fallback={primaryPageLazyFallback}>
      <SettingsPrimaryPageLazy ref={PRIMARY_PAGE_REF_MAP.settings} />
    </Suspense>
  ),
  spells: (
    <Suspense fallback={primaryPageLazyFallback}>
      <SpellsPageLazy ref={PRIMARY_PAGE_REF_MAP.spells} />
    </Suspense>
  ),
  calendar: (
    <Suspense fallback={primaryPageLazyFallback}>
      <CalendarPrimaryPageLazy ref={PRIMARY_PAGE_REF_MAP.calendar} />
    </Suspense>
  )
})

/** Spells is wrapped in `<Suspense>`; navigated props must go to the lazy page, not the boundary. */
function applyPrimaryPageProps(element: ReactNode, props: object): ReactNode {
  if (!isValidElement(element)) return element
  if (element.type === Suspense) {
    const inner = element.props.children
    if (isValidElement(inner)) {
      return cloneElement(element, undefined, cloneElement(inner, props))
    }
  }
  return cloneElement(element, props)
}

// Type for primary page names - use the return type of getPrimaryPageMap
export type TPrimaryPageName = keyof ReturnType<typeof getPrimaryPageMap>

type TPrimaryPageStateEntry = { name: TPrimaryPageName; element: ReactNode; props?: any }

function noteContextToPrimaryEntry(pageContext: string): { name: TPrimaryPageName; props?: object } | null {
  if (pageContext === 'discussions') {
    return { name: 'spells', props: { spell: 'discussions' } }
  }
  if (pageContext === 'explore' || pageContext === 'home') {
    return { name: 'explore' }
  }
  if (pageContext === 'rss') {
    return { name: 'feed' }
  }
  const map = getPrimaryPageMap()
  if (pageContext in map) {
    return { name: pageContext as TPrimaryPageName }
  }
  return null
}

function mergePrimaryPageEntry(
  prev: TPrimaryPageStateEntry[],
  entry: { name: TPrimaryPageName; props?: object }
): TPrimaryPageStateEntry[] {
  const map = getPrimaryPageMap()
  const element = map[entry.name]
  const exists = prev.find((p) => p.name === entry.name)
  if (exists) {
    /** Popstate sync passes `{ props: undefined }` when the URL has no `?spell=` — must clear stale props. */
    if (Object.prototype.hasOwnProperty.call(entry, 'props')) {
      exists.props = entry.props
    } else if (entry.props) {
      exists.props = { ...(exists.props || {}), ...entry.props }
    }
    return [...prev]
  }
  return [...prev, { name: entry.name, element, props: entry.props }]
}

function primaryPagePropsDebugFingerprint(props: object | undefined): string {
  if (!props || typeof props !== 'object') return ''
  return Object.keys(props)
    .sort()
    .join(',')
}

let lastActivePrimaryPageContentDebugKey = ''

function renderActivePrimaryPageContent(
  primaryPages: TPrimaryPageStateEntry[],
  currentPrimaryPage: TPrimaryPageName
): ReactNode {
  const entry =
    primaryPages.find((p) => p.name === currentPrimaryPage) ??
    (primaryPages.length > 0 ? primaryPages[0] : undefined)
  if (!entry) return null
  try {
    const dbgKey = `${currentPrimaryPage}|${entry.name}|${primaryPagePropsDebugFingerprint(entry.props)}`
    if (dbgKey !== lastActivePrimaryPageContentDebugKey) {
      lastActivePrimaryPageContentDebugKey = dbgKey
      logger.debug(`Rendering active primary page: ${entry.name}`)
    }
    return entry.props ? applyPrimaryPageProps(entry.element, entry.props) : entry.element
  } catch (error) {
    logger.error(`Error rendering ${entry.name} component:`, error)
    return (
      <div>
        Error rendering {entry.name}: {error instanceof Error ? error.message : String(error)}
      </div>
    )
  }
}

export { PrimaryPageContext, usePrimaryPage }

export { useSecondaryPage, useSecondaryPageOptional }

import { buildNoteUrl } from '@/lib/note-navigation-url'

function buildRssArticleUrl(
  articleUrl: string,
  currentPage: TPrimaryPageName | null,
  options?: { rssFeedReadOnly?: boolean }
): string {
  const key = encodeRssArticlePathSegment(articleUrl)
  const contextualPages: TPrimaryPageName[] = [
    'search',
    'library',
    'profile',
    'feed',
    'spells',
    'explore',
    'calendar'
  ]
  let path =
    currentPage && contextualPages.includes(currentPage)
      ? `/${currentPage}/rss-item/${key}`
      : `/rss-item/${key}`
  if (options?.rssFeedReadOnly) {
    path += `${path.includes('?') ? '&' : '?'}rssFeedReadOnly=1`
  }
  return path
}

/** True for secondary routes that show an RSS / web article in the panel (contextual or bare). */
function replaceHistoryWithPrimaryPageUrl(
  page: TPrimaryPageName,
  props?: { spell?: string } | Record<string, unknown> | null
) {
  const pageUrl = buildPrimaryPageUrl(page, props as { spell?: string } | undefined)
  window.history.replaceState(null, '', pageUrl)
}

/** Open an RSS article in the secondary panel (same routing pattern as contextual note URLs). */
export function useSmartRssArticleNavigation() {
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { current: currentPrimaryPage } = usePrimaryPage()

  const navigateToRssArticle = (
    articleUrl: string,
    navOptions?: { rssFeedReadOnly?: boolean }
  ) => {
    pushSecondaryPage(buildRssArticleUrl(articleUrl, currentPrimaryPage, navOptions))
  }

  return { navigateToRssArticle }
}

// Helper function to build contextual relay URL
function buildRelayUrl(relayUrl: string, currentPage: TPrimaryPageName | null): string {
  const encodedRelayUrl = encodeURIComponent(relayUrl)
  
  if (currentPage === 'explore') {
    return `/explore/relays/${encodedRelayUrl}`
  }
  
  return `/relays/${encodedRelayUrl}`
}

/** Path (+ query for spells) pushed when navigating primary pages — shareable URLs for faux spells. */
function buildPrimaryPageUrl(
  page: TPrimaryPageName,
  props?: { spell?: string } | Record<string, unknown> | null
): string {
  if (page === 'feed') return '/'
  if (page === 'explore') return '/explore'
  if (page === 'spells') {
    const spell =
      props && typeof (props as { spell?: unknown }).spell === 'string'
        ? String((props as { spell: string }).spell).trim()
        : ''
    if (spell) return `/spells?spell=${encodeURIComponent(spell)}`
    return '/spells'
  }
  return `/${page}`
}

function spellPropsFromSearch(search: string): { spell: string } | undefined {
  const spell = new URLSearchParams(search).get('spell')?.trim()
  return spell ? { spell } : undefined
}

export { useSmartNoteNavigation, useSmartNoteNavigationOptional } from '@/hooks/use-smart-note-navigation'

// Fixed: Relay navigation now uses primary note view on mobile, secondary routing (drawer in single-pane, side panel in double-pane) on desktop
export function useSmartRelayNavigation() {
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { current: currentPrimaryPage } = usePrimaryPage()
  
  const navigateToRelay = (url: string) => {
    // Extract relay URL from path (handles both /relays/{url} and /{context}/relays/{url})
    const relayUrlMatch =
      url.match(
        /\/(discussions|search|profile|home|feed|spells|explore)\/relays\/(.+)$/
      ) ||
      url.match(/\/relays\/(.+)$/)
    const relayUrl = relayUrlMatch ? decodeURIComponent(relayUrlMatch[relayUrlMatch.length - 1]) : decodeURIComponent(url.replace(/.*\/relays\//, ''))
    
    // Build contextual URL based on current page
    const contextualUrl = buildRelayUrl(relayUrl, currentPrimaryPage)
    
    pushSecondaryPage(contextualUrl)
  }
  
  return { navigateToRelay }
}

/** Safe variant for createRoot trees. Returns fallback navigation when outside providers. */
export function useSmartRelayNavigationOptional() {
  const primaryNoteView = usePrimaryNoteViewOptional()
  const secondaryPage = useSecondaryPageOptional()
  const screenSize = useScreenSizeOptional()
  const primaryPage = usePrimaryPageOptional()
  if (!primaryNoteView || !secondaryPage || !screenSize || !primaryPage) {
    return { navigateToRelay: (url: string) => { window.location.href = url } }
  }
  const { push: pushSecondaryPage } = secondaryPage
  const { current: currentPrimaryPage } = primaryPage
  const navigateToRelay = (url: string) => {
    const relayUrlMatch =
      url.match(
        /\/(discussions|search|profile|home|feed|spells|explore)\/relays\/(.+)$/
      ) ||
      url.match(/\/relays\/(.+)$/)
    const relayUrl = relayUrlMatch ? decodeURIComponent(relayUrlMatch[relayUrlMatch.length - 1]) : decodeURIComponent(url.replace(/.*\/relays\//, ''))
    const contextualUrl = buildRelayUrl(relayUrl, currentPrimaryPage)
    pushSecondaryPage(contextualUrl)
  }
  return { navigateToRelay }
}

// Profile navigation: primary overlay on mobile, secondary panel on desktop.
export function useSmartProfileNavigation() {
  const { setPrimaryNoteView } = usePrimaryNoteView()
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()
  
  const navigateToProfile = (url: string) => {
    if (isSmallScreen) {
      const profileId = url.replace('/users/', '')
      window.history.pushState(null, '', url)
      setPrimaryNoteView(
        suspensePrimaryPage(<SecondaryProfilePageLazy id={profileId} index={0} hideTitlebar={true} />),
        'profile'
      )
    } else {
      pushSecondaryPage(url)
    }
  }
  
  return { navigateToProfile }
}

/** Safe variant for createRoot trees (e.g. AsciidocArticle embedded mentions). Returns fallback navigation when outside providers. */
export function useSmartProfileNavigationOptional() {
  const primaryNoteView = usePrimaryNoteViewOptional()
  const secondaryPage = useSecondaryPageOptional()
  const screenSize = useScreenSizeOptional()

  if (!primaryNoteView || !secondaryPage || !screenSize) {
    return {
      navigateToProfile: (url: string) => {
        window.location.href = url
      }
    }
  }

  const { setPrimaryNoteView } = primaryNoteView
  const { push: pushSecondaryPage } = secondaryPage
  const { isSmallScreen } = screenSize

  const navigateToProfile = (url: string) => {
    if (isSmallScreen) {
      const profileId = url.replace('/users/', '')
      window.history.pushState(null, '', url)
      setPrimaryNoteView(
        suspensePrimaryPage(<SecondaryProfilePageLazy id={profileId} index={0} hideTitlebar={true} />),
        'profile'
      )
    } else {
      pushSecondaryPage(url)
    }
  }
  return { navigateToProfile }
}

// Hashtag / d-tag note list opens on the secondary stack (right panel), same as other search routes.
export function useSmartHashtagNavigation() {
  const { push: pushSecondaryPage } = useSecondaryPage()

  const navigateToHashtag = (url: string) => {
    const parsedUrl = url.startsWith('/') ? url : `/${url}`
    pushSecondaryPage(parsedUrl)
    window.dispatchEvent(new CustomEvent('hashtag-navigation', { detail: { url: parsedUrl } }))
  }

  return { navigateToHashtag }
}

/** Safe variant for createRoot trees. Returns fallback navigation when outside providers. */
export function useSmartHashtagNavigationOptional() {
  const secondaryPage = useSecondaryPageOptional()
  if (!secondaryPage) {
    return {
      navigateToHashtag: (url: string) => {
        window.location.href = url.startsWith('/') ? url : `/${url}`
      }
    }
  }
  const { push } = secondaryPage
  const navigateToHashtag = (url: string) => {
    const parsedUrl = url.startsWith('/') ? url : `/${url}`
    push(parsedUrl)
    window.dispatchEvent(new CustomEvent('hashtag-navigation', { detail: { url: parsedUrl } }))
  }
  return { navigateToHashtag }
}

// Fixed: Following list navigation now uses primary note view on mobile, secondary routing on desktop
export function useSmartFollowingListNavigation() {
  const { setPrimaryNoteView } = usePrimaryNoteView()
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()
  
  const navigateToFollowingList = (url: string) => {
    if (isSmallScreen) {
      // Use primary note view on mobile
      const profileId = url.replace('/users/', '').replace('/following', '')
      window.history.pushState(null, '', url)
      setPrimaryNoteView(
        suspensePrimaryPage(<PrimaryFollowingListPageLazy id={profileId} index={0} hideTitlebar={true} />),
        'following'
      )
    } else {
      // Use secondary routing on desktop
      pushSecondaryPage(url)
    }
  }
  
  return { navigateToFollowingList }
}

export function useSmartFollowersListNavigation() {
  const { setPrimaryNoteView } = usePrimaryNoteView()
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()

  const navigateToFollowersList = (url: string) => {
    if (isSmallScreen) {
      const profileId = url.replace('/users/', '').replace('/followers', '')
      window.history.pushState(null, '', url)
      setPrimaryNoteView(
        suspensePrimaryPage(<PrimaryFollowersListPageLazy id={profileId} index={0} hideTitlebar={true} />),
        'followers'
      )
    } else {
      pushSecondaryPage(url)
    }
  }

  return { navigateToFollowersList }
}

// Fixed: Mute list navigation now uses primary note view on mobile, secondary routing on desktop
export function useSmartMuteListNavigation() {
  const { setPrimaryNoteView } = usePrimaryNoteView()
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()
  
  const navigateToMuteList = (url: string) => {
    if (isSmallScreen) {
      // Use primary note view on mobile
      window.history.pushState(null, '', url)
      setPrimaryNoteView(suspensePrimaryPage(<PrimaryMuteListPageLazy index={0} hideTitlebar={true} />), 'mute')
    } else {
      // Use secondary routing on desktop
      pushSecondaryPage(url)
    }
  }
  
  return { navigateToMuteList }
}

export function useSmartBookmarkListNavigation() {
  const { setPrimaryNoteView } = usePrimaryNoteView()
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()

  const navigateToBookmarkList = (url: string) => {
    if (isSmallScreen) {
      window.history.pushState(null, '', url)
      setPrimaryNoteView(
        suspensePrimaryPage(<PrimaryBookmarkListPageLazy index={0} hideTitlebar={true} />),
        'bookmarks'
      )
    } else {
      pushSecondaryPage(url)
    }
  }

  return { navigateToBookmarkList }
}

export function useSmartPinListNavigation() {
  const { setPrimaryNoteView } = usePrimaryNoteView()
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()

  const navigateToPinList = (url: string) => {
    if (isSmallScreen) {
      window.history.pushState(null, '', url)
      setPrimaryNoteView(
        suspensePrimaryPage(<PrimaryPinListPageLazy index={0} hideTitlebar={true} />),
        'pins'
      )
    } else {
      pushSecondaryPage(url)
    }
  }

  return { navigateToPinList }
}

export function useSmartProfileBadgesListNavigation() {
  const { setPrimaryNoteView } = usePrimaryNoteView()
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()

  const navigateToProfileBadgesList = (url: string) => {
    if (isSmallScreen) {
      window.history.pushState(null, '', url)
      setPrimaryNoteView(
        suspensePrimaryPage(<PrimaryProfileBadgesListPageLazy index={0} hideTitlebar={true} />),
        'profile-badges'
      )
    } else {
      pushSecondaryPage(url)
    }
  }

  return { navigateToProfileBadgesList }
}

export function useSmartNotificationThreadFollowListNavigation() {
  const { setPrimaryNoteView } = usePrimaryNoteView()
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()

  const navigateToNotificationThreadFollowList = (url: string) => {
    if (isSmallScreen) {
      window.history.pushState(null, '', url)
      setPrimaryNoteView(
        suspensePrimaryPage(<PrimaryNotificationThreadFollowListPageLazy index={0} hideTitlebar={true} />),
        'notification-thread-follow'
      )
    } else {
      pushSecondaryPage(url)
    }
  }

  return { navigateToNotificationThreadFollowList }
}

export function useSmartNotificationThreadMuteListNavigation() {
  const { setPrimaryNoteView } = usePrimaryNoteView()
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()

  const navigateToNotificationThreadMuteList = (url: string) => {
    if (isSmallScreen) {
      window.history.pushState(null, '', url)
      setPrimaryNoteView(
        suspensePrimaryPage(<PrimaryNotificationThreadMuteListPageLazy index={0} hideTitlebar={true} />),
        'notification-thread-mute'
      )
    } else {
      pushSecondaryPage(url)
    }
  }

  return { navigateToNotificationThreadMuteList }
}

export function useSmartInterestListNavigation() {
  const { setPrimaryNoteView } = usePrimaryNoteView()
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()

  const navigateToInterestList = (url: string) => {
    if (isSmallScreen) {
      window.history.pushState(null, '', url)
      setPrimaryNoteView(
        suspensePrimaryPage(<PrimaryInterestListPageLazy index={0} hideTitlebar={true} />),
        'interests'
      )
    } else {
      pushSecondaryPage(url)
    }
  }

  return { navigateToInterestList }
}

export function useSmartUserEmojiListNavigation() {
  const { setPrimaryNoteView } = usePrimaryNoteView()
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()

  const navigateToUserEmojiList = (url: string) => {
    if (isSmallScreen) {
      window.history.pushState(null, '', url)
      setPrimaryNoteView(
        suspensePrimaryPage(<PrimaryUserEmojiListPageLazy index={0} hideTitlebar={true} />),
        'user-emojis'
      )
    } else {
      pushSecondaryPage(url)
    }
  }

  return { navigateToUserEmojiList }
}

// Fixed: Others relay settings navigation now uses primary note view on mobile, secondary routing on desktop
export function useSmartOthersRelaySettingsNavigation() {
  const { setPrimaryNoteView } = usePrimaryNoteView()
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()
  
  const navigateToOthersRelaySettings = (url: string) => {
    if (isSmallScreen) {
      // Use primary note view on mobile
      const profileId = url.replace('/users/', '').replace('/relays', '')
      window.history.pushState(null, '', url)
      setPrimaryNoteView(
        suspensePrimaryPage(
          <PrimaryOthersRelaySettingsPageLazy id={profileId} index={0} hideTitlebar={true} />
        ),
        'others-relay-settings'
      )
    } else {
      // Use secondary routing on desktop
      pushSecondaryPage(url)
    }
  }
  
  return { navigateToOthersRelaySettings }
}

/** Settings index is a normal primary page; sub-routes open on the secondary stack (panel / drawer). */
export function useSmartSettingsNavigation() {
  const { navigate: navigatePrimary } = usePrimaryPage()
  const { push: pushSecondaryPage } = useSecondaryPage()

  const navigateToSettings = (url: string) => {
    const base = url.split('?')[0].split('#')[0]
    if (base === '/settings') {
      navigatePrimary('settings')
      return
    }
    pushSecondaryPage(url)
  }

  return { navigateToSettings }
}

function getPageTitle(viewType: TPrimaryOverlayViewType | null, pathname: string): string {
  // Create a temporary navigation service instance to use the getPageTitle method
  const tempService = new NavigationService({ setPrimaryNoteView: () => {} })
  return tempService.getPageTitle(viewType, pathname)
}

function MainContentArea({
  primaryPages, 
  currentPrimaryPage, 
  primaryNoteView,
  primaryViewType,
  goBack,
  onPrimaryPanelRefresh
}: {
  primaryPages: { name: TPrimaryPageName; element: ReactNode; props?: any }[]
  currentPrimaryPage: TPrimaryPageName
  primaryNoteView: ReactNode | null
  primaryViewType: TPrimaryOverlayViewType | null
  goBack: () => void
  onPrimaryPanelRefresh: () => void
}) {
  const [, forceUpdate] = useState(0)
  const mainContentDebugRef = useRef({
    currentPrimaryPage: '' as TPrimaryPageName,
    pages: '',
    noteView: false
  })

  const pagesKey = primaryPages.map((p) => p.name).join(',')
  const noteView = !!primaryNoteView

  // Listen for note page title updates
  useEffect(() => {
    const handleTitleUpdate = () => {
      forceUpdate(n => n + 1)
    }
    window.addEventListener('notePageTitleUpdated', handleTitleUpdate)
    return () => {
      window.removeEventListener('notePageTitleUpdated', handleTitleUpdate)
    }
  }, [])

  useEffect(() => {
    const prevDbg = mainContentDebugRef.current
    if (
      prevDbg.currentPrimaryPage !== currentPrimaryPage ||
      prevDbg.pages !== pagesKey ||
      prevDbg.noteView !== noteView
    ) {
      mainContentDebugRef.current = {
        currentPrimaryPage,
        pages: pagesKey,
        noteView
      }
      logger.debug('MainContentArea rendering:', {
        currentPrimaryPage,
        primaryPages: primaryPages.map((p) => p.name),
        primaryNoteView: noteView
      })
    }
  }, [currentPrimaryPage, pagesKey, noteView, primaryPages])
  
  // flex + min-h-0 + min-w-0 so primary pages get a real height in flex parents and can shrink horizontally (double-pane).
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col w-full px-2 pt-3 pb-2">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-border bg-card shadow-lg">
        {primaryNoteView ? (
          // Show note view with back button
          <div className="flex h-full min-h-0 min-w-0 w-full flex-col">
            <ImwaldBrandBar />
            <div className="flex gap-1 border-b border-border p-1 items-center justify-between font-semibold">
              <div className="flex items-center flex-1 w-0">
                <Button
                  className="flex gap-1 items-center w-fit max-w-full justify-start pl-2 pr-3"
                  variant="ghost"
                  size="titlebar-icon"
                  title="Back"
                  onClick={goBack}
                >
                  <ChevronLeft />
                  <div className="app-chrome-title truncate">Back</div>
                </Button>
              </div>
              <div className="flex-1 flex justify-center">
                <div className="text-lg font-semibold">
                  {getPageTitle(primaryViewType, window.location.pathname)}
                </div>
              </div>
              <div className="flex flex-1 w-0 justify-end pr-1">
                <RefreshButton onClick={onPrimaryPanelRefresh} />
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {primaryNoteView}
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
            {renderActivePrimaryPageContent(primaryPages, currentPrimaryPage)}
          </div>
        )}
      </div>
    </div>
  )
}

export function PageManager({ maxStackSize = 5 }: { maxStackSize?: number }) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const [currentPrimaryPage, setCurrentPrimaryPage] = useState<TPrimaryPageName>('feed')
  const [primaryPages, setPrimaryPages] = useState<
    { name: TPrimaryPageName; element: ReactNode; props?: any }[]
  >([
    {
      name: 'feed',
      element: getPrimaryPageMap().feed
    }
  ])
  const [secondaryStack, setSecondaryStack] = useState<TStackItem[]>([])
  /** Latest stack for popstate / pop() — avoids stale length when history and React state race. */
  const secondaryStackRef = useRef<TStackItem[]>([])
  /** Suppress duplicate pushSecondaryPage calls (e.g. React Strict Mode) within a short window. */
  const recentSecondaryPushRef = useRef<{ url: string; at: number } | null>(null)
  useLayoutEffect(() => {
    secondaryStackRef.current = secondaryStack
  }, [secondaryStack])
  const [primaryNoteView, setPrimaryNoteViewState] = useState<ReactNode | null>(null)
  const [primaryViewType, setPrimaryViewType] = useState<TPrimaryOverlayViewType | null>(null)
  const [savedPrimaryPage, setSavedPrimaryPage] = useState<TPrimaryPageName | null>(null)
  /** Latest primary page for async callbacks without resubscribing effects on every primary change. */
  const currentPrimaryPageRef = useRef<TPrimaryPageName>(currentPrimaryPage)
  useLayoutEffect(() => {
    currentPrimaryPageRef.current = currentPrimaryPage
  }, [currentPrimaryPage])
  const navigationCounterRef = useRef(0)
  const goBackRef = useRef<() => void>(() => {})
  const popSecondaryPageRef = useRef<() => void>(() => {})
  const [mobilePrimarySwipeRoot, setMobilePrimarySwipeRoot] = useState<HTMLElement | null>(null)
  const [mobileSecondarySwipeRoot, setMobileSecondarySwipeRoot] = useState<HTMLElement | null>(null)
  const primaryPanelRefreshRef = useRef<(() => void) | null>(null)
  const registerPrimaryPanelRefresh = useCallback((fn: (() => void) | null) => {
    primaryPanelRefreshRef.current = fn
  }, [])
  const triggerPrimaryPanelRefresh = useCallback(() => {
    primaryPanelRefreshRef.current?.()
  }, [])
  const savedFeedStateRef = useRef<Map<TPrimaryPageName, { tab?: string }>>(new Map())
  const currentTabStateRef = useRef<Map<TPrimaryPageName, string>>(new Map()) // Track current tab state for each page
  const savedPrimaryPagePropsRef = useRef<object | undefined>(undefined)
  const primaryPagePropsRef = useRef<Map<TPrimaryPageName, object | undefined>>(new Map())

  const currentPageProps = useMemo((): object | undefined => {
    const entry = primaryPages.find((p) => p.name === currentPrimaryPage)
    return entry?.props as object | undefined
  }, [primaryPages, currentPrimaryPage])

  /** Keeps spell query (?spell=) and other primary props for URL restore after popstate — refs were never written before. */
  useEffect(() => {
    const m = primaryPagePropsRef.current
    for (const p of primaryPages) {
      m.set(p.name, p.props)
    }
  }, [primaryPages])

  const setPrimaryNoteView = (view: ReactNode | null, type?: TPrimaryOverlayViewType) => {
    if (view && !primaryNoteView) {
      // Saving current primary page before showing overlay
      savedPrimaryPagePropsRef.current = primaryPages.find((p) => p.name === currentPrimaryPage)?.props as
        | object
        | undefined
      setSavedPrimaryPage(currentPrimaryPage)
      
      // Get current tab state from ref (updated by components via events)
      const currentTab = currentTabStateRef.current.get(currentPrimaryPage)

      if (currentTab) {
        logger.info('PageManager: Saving page state', {
          page: currentPrimaryPage,
          tab: currentTab
        })
        savedFeedStateRef.current.set(currentPrimaryPage, {
          tab: currentTab
        })
      }
    }
    
    // Increment navigation counter when setting a new view to ensure unique keys
    // This forces React to remount components even when navigating between items of the same type
    if (view) {
      navigationCounterRef.current += 1
    }
    
    // Always update the view state - even if the type is the same, the component might be different
    // This ensures that navigation works even when navigating between items of the same type (e.g., different hashtags)
    setPrimaryNoteViewState(view)
    setPrimaryViewType(type || null)
    
    // If clearing the view, restore to the saved primary page
    if (!view && savedPrimaryPage) {
      const newUrl = buildPrimaryPageUrl(
        savedPrimaryPage,
        savedPrimaryPagePropsRef.current as { spell?: string } | undefined
      )
      window.history.replaceState(null, '', newUrl)
      
      const savedFeedState = savedFeedStateRef.current.get(savedPrimaryPage)
      
      // Restore tab state first
      if (savedFeedState?.tab) {
        logger.info('PageManager: Restoring tab state', { page: savedPrimaryPage, tab: savedFeedState.tab })
        window.dispatchEvent(new CustomEvent('restorePageTab', { 
          detail: { page: savedPrimaryPage, tab: savedFeedState.tab } 
        }))
        currentTabStateRef.current.set(savedPrimaryPage, savedFeedState.tab)
      }
    }
  }

  const ignorePopStateRef = useRef(false)

  // Handle browser back button for primary note view
  useEffect(() => {
    const handlePopState = () => {
      if (ignorePopStateRef.current) {
        ignorePopStateRef.current = false
        return
      }
      
      if (primaryNoteView) {
        setPrimaryNoteView(null)
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [primaryNoteView])

  useEffect(() => {
    if (historyLocationSeedApplied) return
    historyLocationSeedApplied = true
    if (['/npub1', '/nprofile1'].some((prefix) => window.location.pathname.startsWith(prefix))) {
      window.history.replaceState(
        null,
        '',
        '/users' + window.location.pathname + window.location.search + window.location.hash
      )
    } else if (
      ['/note1', '/nevent1', '/naddr1'].some((prefix) =>
        window.location.pathname.startsWith(prefix)
      )
    ) {
      window.history.replaceState(
        null,
        '',
        '/notes' + window.location.pathname + window.location.search + window.location.hash
      )
    } else if (
      window.location.pathname === '/follows-latest' ||
      window.location.pathname.startsWith('/follows-latest/')
    ) {
      /** `/follows-latest` primary page removed — rewrite to `/feed` (same suffix e.g. `/notes/…`). */
      window.history.replaceState(
        null,
        '',
        '/feed' +
          window.location.pathname.slice('/follows-latest'.length) +
          window.location.search +
          window.location.hash
      )
    }
    // OG HTML proxy (`VITE_PROXY_SERVER`, e.g. https://host/proxy) must be reverse-proxied to the
    // fetch service. If /proxy is routed to this SPA, normalize to / so we don't push an unknown URL.
    {
      const proxyPath = window.location.pathname.split('?')[0].split('#')[0]
      if (proxyPath === '/proxy' || proxyPath.startsWith('/proxy/')) {
        window.history.replaceState(null, '', '/')
      }
    }
    window.history.pushState(null, '', window.location.href)
    if (window.location.pathname !== '/') {
      const url = window.location.pathname + window.location.search + window.location.hash
      const pathname = window.location.pathname
      
      // Check if this is a note URL - handle both /notes/{id} and /{context}/notes/{id}
      const contextualNoteMatch = pathname.match(/\/(discussions|search|profile|home|feed|spells|explore|rss|calendar)\/notes\/(.+)$/)
      const standardNoteMatch = pathname.match(/\/notes\/(.+)$/)
      const noteUrlMatch = contextualNoteMatch || standardNoteMatch
      
      if (noteUrlMatch) {
        const noteId = noteUrlMatch[noteUrlMatch.length - 1].split('?')[0].split('#')[0]
        if (noteId) {
          let primaryForNoteUrl: TPrimaryPageName = currentPrimaryPage

          const pushNoteUrlOnStack = (noteUrl: string) => {
            setSecondaryStack((prevStack) => {
              if (isCurrentPage(prevStack, noteUrl)) {
                const top = prevStack[prevStack.length - 1]
                if (top && !top.component) {
                  const restored = ensureStackItemComponent(top)
                  if (restored.component) {
                    window.history.replaceState(
                      { index: restored.index, url: noteUrl },
                      '',
                      noteUrl
                    )
                    return [...prevStack.slice(0, -1), restored]
                  }
                }
                return prevStack
              }
              const { newStack, newItem } = pushNewPageToStack(prevStack, noteUrl, maxStackSize)
              if (newItem) {
                window.history.replaceState({ index: newItem.index, url: noteUrl }, '', noteUrl)
              }
              return newStack
            })
          }

          // If this is a contextual note URL, set the primary page first
          if (contextualNoteMatch) {
            const pageContext = contextualNoteMatch[1]
            const resolved = noteContextToPrimaryEntry(pageContext)
            if (resolved) {
              primaryForNoteUrl = resolved.name
              setCurrentPrimaryPage(resolved.name)
              setPrimaryPages((prev) => mergePrimaryPageEntry(prev, resolved))
              setSavedPrimaryPage(resolved.name)
            }
          }

          const contextualUrl = buildNoteUrl(noteId, primaryForNoteUrl)
          pushNoteUrlOnStack(contextualUrl)
          return
        }
      }

      // RSS article in side panel: /{context}/rss-item/{key} or /rss-item/{key}
      const contextualRssMatch = pathname.match(
        /^\/(discussions|search|profile|home|feed|spells|explore|rss|calendar)\/rss-item\/([^/?#]+)/
      )
      const standardRssMatch = pathname.match(/^\/rss-item\/([^/?#]+)/)
      const rssArticleKey = contextualRssMatch?.[2] ?? standardRssMatch?.[1]
      if (rssArticleKey) {
        let decodedArticleUrl = ''
        try {
          decodedArticleUrl = decodeRssArticlePathSegment(rssArticleKey)
        } catch {
          decodedArticleUrl = ''
        }
        if (decodedArticleUrl) {
          const resolvedRss = contextualRssMatch
            ? noteContextToPrimaryEntry(contextualRssMatch[1])
            : null
          const rssPrimaryEntry: { name: TPrimaryPageName; props?: object } = resolvedRss ?? {
            name: 'feed'
          }

          const applyRssPrimary = () => {
            setCurrentPrimaryPage(rssPrimaryEntry.name)
            setPrimaryPages((prev) => mergePrimaryPageEntry(prev, rssPrimaryEntry))
            setSavedPrimaryPage(rssPrimaryEntry.name)
          }

          applyRssPrimary()

          const contextualRssUrl = buildRssArticleUrl(decodedArticleUrl, rssPrimaryEntry.name)

          setSecondaryStack((prevStack) => {
            if (isCurrentPage(prevStack, contextualRssUrl)) return prevStack

            const { newStack, newItem } = pushNewPageToStack(prevStack, contextualRssUrl, maxStackSize)
            if (newItem) {
              window.history.replaceState({ index: newItem.index, url: contextualRssUrl }, '', contextualRssUrl)
            }
            return newStack
          })
          return
        }
      }

      // Check if this is a primary page URL - don't push primary pages to secondary stack
      const pathnameOnly = pathname.split('?')[0].split('#')[0]
      const segments = pathnameOnly.split('/').filter(Boolean)
      const firstSeg = segments[0] ?? ''
      const primaryMap = getPrimaryPageMap()
      const isPrimaryPageUrl =
        segments.length === 0 ||
        (segments.length === 1 &&
          (firstSeg === 'discussions' ||
            firstSeg === 'home' ||
            firstSeg === 'explore' ||
            firstSeg === 'rss' ||
            firstSeg in primaryMap))

      if (isPrimaryPageUrl) {
        // This is a primary page - just navigate to it, don't push to secondary stack
        const pageName: TPrimaryPageName | 'discussions' | null =
          segments.length === 0
            ? 'feed'
            : firstSeg === 'home'
              ? 'explore'
              : firstSeg === 'discussions'
                ? 'discussions'
                : firstSeg === 'rss'
                  ? 'feed'
                : firstSeg in primaryMap
                  ? (firstSeg as TPrimaryPageName)
                  : null
        if (pageName === 'explore') {
          navigatePrimaryPage('explore')
          requestAnimationFrame(() => {
            window.dispatchEvent(
              new CustomEvent('restorePageTab', { detail: { page: 'explore', tab: 'explore' } })
            )
          })
        } else if (pageName === 'discussions') {
          navigatePrimaryPage('spells', { spell: 'discussions' })
        } else if (pageName === 'spells') {
          const spellProps = spellPropsFromSearch(window.location.search)
          navigatePrimaryPage('spells', spellProps)
        } else if (pageName && pageName in primaryMap) {
          navigatePrimaryPage(pageName as TPrimaryPageName)
        }
        return
      }
      
      // For relay URLs and other non-note URLs, push to secondary stack (side panel on desktop).
      const pathOnlyForSecondary = pathname.split('?')[0].split('#')[0]
      if (pathOnlyForSecondary.startsWith('/settings/') && pathOnlyForSecondary !== '/settings') {
        setCurrentPrimaryPage('settings')
        setPrimaryPages((prev) => mergePrimaryPageEntry(prev, { name: 'settings' }))
      }

      setSecondaryStack((prevStack) => {
        if (isCurrentPage(prevStack, url)) return prevStack

        const { newStack, newItem } = pushNewPageToStack(prevStack, url, maxStackSize)
        if (newItem) {
          window.history.replaceState({ index: newItem.index, url }, '', url)
        }
        return newStack
      })
    } else {
      // Check for relay URL in query params (legacy support)
      const searchParams = new URLSearchParams(window.location.search)
      const r = searchParams.get('r')
      
      if (r) {
        const url = normalizeUrl(r)
        if (url) {
          navigatePrimaryPage('relay', { url })
          return
        }
      }
      
      // Parse pathname to determine primary page
      const pathname: string = window.location.pathname
      
      // Handle dedicated paths for primary pages
      if (pathname === '/') {
        navigatePrimaryPage('feed')
      } else if (pathname === '/home') {
        navigatePrimaryPage('explore')
      } else {
        // Check if pathname matches a primary page name
        // First, check if it's a contextual note URL (e.g., /discussions/notes/...)
        const contextualNoteMatch = pathname.match(
          /^\/(discussions|search|profile|home|feed|spells|explore|rss|calendar)\/notes\//
        )
        if (contextualNoteMatch) {
          const pageContext = contextualNoteMatch[1]
          const resolved = noteContextToPrimaryEntry(pageContext)
          if (resolved) {
            navigatePrimaryPage(resolved.name, resolved.props)
            // The note URL will be handled by the note URL parsing above
          }
          return
        }

        // Check if it's a standard primary page path
        const pageName: string = pathname.slice(1).split('/')[0] // Get first segment after slash
        if (pageName === 'discussions') {
          navigatePrimaryPage('spells', { spell: 'discussions' })
          return
        }
        if (pageName === 'explore') {
          navigatePrimaryPage('explore')
          requestAnimationFrame(() => {
            window.dispatchEvent(
              new CustomEvent('restorePageTab', { detail: { page: 'explore', tab: 'explore' } })
            )
          })
          return
        }
        if (pageName === 'spells') {
          const spellProps = spellPropsFromSearch(window.location.search)
          navigatePrimaryPage('spells', spellProps)
          return
        }
        if (pageName && pageName in getPrimaryPageMap()) {
          // For relay page, check if there's a URL prop
          if (pageName === 'relay') {
            // Relay URLs are handled via secondary routing, not primary pages
            // This should be caught earlier in the URL parsing
          } else {
            navigatePrimaryPage(pageName as TPrimaryPageName)
          }
        }
        // If pathname doesn't match a primary page, it might be a secondary route
        // which is handled elsewhere
      }
    }

    const onPopState = (e: PopStateEvent) => {
      if (ignorePopStateRef.current) {
        ignorePopStateRef.current = false
        return
      }

      // If the side panel has frames, this popstate is almost certainly stack navigation — do not let
      // modalManager steal it (history.forward + return), which leaves the URL changed and the panel stale.
      const browserPathOnlyEarly = window.location.pathname.split('?')[0].split('#')[0]
      if (secondaryStackRef.current.length === 0) {
        if (!isPrimaryOnlyPathname(browserPathOnlyEarly)) {
          const locUrl =
            window.location.pathname + window.location.search + window.location.hash
          const synced = syncSecondaryStackWhenPopStateStateIsNull([], locUrl)
          if (synced.length > 0) {
            secondaryStackRef.current = synced
            setSecondaryStack(synced)
            return
          }
        }
        const closeModal = modalManager.pop()
        if (closeModal) {
          ignorePopStateRef.current = true
          window.history.forward()
          return
        }
      }

      const browserPathOnly = window.location.pathname.split('?')[0].split('#')[0]
      if (
        isPrimaryOnlyPathname(browserPathOnly) &&
        secondaryStackRef.current.length > 0
      ) {
        secondaryStackRef.current = []
        setSecondaryStack([])
        restorePrimaryTabAfterSecondaryClose()
        return
      }

      let state = e.state as { index: number; url: string } | null
      
      // Prefer the live address bar when history.state.url is stale after replaceState.
      const urlToCheck =
        state?.url && !isPrimaryOnlyPathname(browserPathOnly)
          ? state.url
          : window.location.pathname + window.location.search + window.location.hash
      
      // Check if it's a note URL (stack sync below)
      const noteUrlMatch = urlToCheck.match(/\/(discussions|search|profile|home|feed|spells|explore|rss|calendar)\/notes\/(.+)$/) || 
                          urlToCheck.match(/\/notes\/(.+)$/)
      const noteIdToShow = noteUrlMatch ? noteUrlMatch[noteUrlMatch.length - 1].split('?')[0].split('#')[0] : null

      // Keep spells faux spell in sync with ?spell= on browser back/forward
      if (!noteIdToShow) {
        const syncSegs = window.location.pathname.split('/').filter(Boolean)
        if (syncSegs.length === 1 && syncSegs[0] === 'spells') {
          const spellProps = spellPropsFromSearch(window.location.search)
          setCurrentPrimaryPage('spells')
          setPrimaryPages((prev) => mergePrimaryPageEntry(prev, { name: 'spells', props: spellProps }))
        }
        // Contextual RSS article: align primary pane when using browser history
        let rssPathSync = window.location.pathname.split('?')[0].split('#')[0]
        try {
          if (urlToCheck.startsWith('http://') || urlToCheck.startsWith('https://')) {
            rssPathSync = new URL(urlToCheck).pathname
          }
        } catch {
          /* keep pathname */
        }
        const ctxRssPop = rssPathSync.match(
          /^\/(discussions|search|profile|home|feed|spells|explore|rss|calendar)\/rss-item\/([^/?#]+)/
        )
        if (ctxRssPop) {
          const resolvedPop = noteContextToPrimaryEntry(ctxRssPop[1])
          if (resolvedPop) {
            setCurrentPrimaryPage(resolvedPop.name)
            setPrimaryPages((prev) => mergePrimaryPageEntry(prev, resolvedPop))
            setSavedPrimaryPage(resolvedPop.name)
          }
        } else if (/^\/rss-item\/[^/?#]+/.test(rssPathSync)) {
          setCurrentPrimaryPage('feed')
          setPrimaryPages((prev) => mergePrimaryPageEntry(prev, { name: 'feed' }))
          setSavedPrimaryPage('feed')
        }
      }

      setSecondaryStack((pre) => {
        const currentItem = pre[pre.length - 1] as TStackItem | undefined
        const currentIndex = currentItem?.index
        if (!state) {
          const locUrl =
            window.location.pathname + window.location.search + window.location.hash
          if (locUrl !== '/' && locUrl !== '') {
            const synced = syncSecondaryStackWhenPopStateStateIsNull(pre, locUrl)
            return synced
          }
          state = { index: -1, url: '/' }
        }

        // Go forward
        if (currentIndex === undefined || state.index > currentIndex) {
          const { newStack } = pushNewPageToStack(pre, state.url, maxStackSize)
          return newStack
        }

        if (state.index === currentIndex && currentItem) {
          const historyState = state
          const browserLoc =
            window.location.pathname + window.location.search + window.location.hash
          if (
            !secondaryPanelUrlsMatch(currentItem.url, browserLoc) &&
            !secondaryPanelUrlsMatch(currentItem.url, historyState.url)
          ) {
            return syncSecondaryStackWhenPopStateStateIsNull(pre, browserLoc)
          }
          const urlMatches =
            currentItem.url === historyState.url ||
            secondaryPanelUrlsMatch(currentItem.url, historyState.url)
          if (urlMatches) {
            return pre
          }
          const j = pre.findIndex(
            (item) =>
              item.index === historyState.index &&
              (item.url === historyState.url ||
                secondaryPanelUrlsMatch(item.url, historyState.url))
          )
          if (j >= 0) {
            const sliced = pre.slice(0, j + 1)
            const nt = sliced[sliced.length - 1]
            if (nt && !nt.component) {
              const { component, ref } = findAndCreateComponent(nt.url, nt.index)
              if (component) {
                nt.component = component
                nt.ref = ref
              }
            }
            return sliced
          }
          const built = findAndCreateComponent(historyState.url, historyState.index)
          if (built.component) {
            return [
              {
                index: historyState.index,
                url: historyState.url,
                component: built.component,
                ref: built.ref
              }
            ]
          }
          return syncSecondaryStackWhenPopStateStateIsNull(pre, historyState.url)
        }

        // Go back
        const newStack = pre.filter((item) => item.index <= state!.index)
        const topItem = newStack[newStack.length - 1] as TStackItem | undefined
        
        if (!topItem) {
          // Stack is empty - check if this is a primary page URL or a secondary route
          const pathname = state.url.split('?')[0].split('#')[0]
          const popSegments = pathname.split('/').filter(Boolean)
          const popFirstSeg = popSegments[0] ?? ''
          const popPrimaryMap = getPrimaryPageMap()
          const isPrimaryPage =
            popSegments.length === 0 ||
            (popSegments.length === 1 &&
              (popFirstSeg === 'discussions' ||
                popFirstSeg === 'home' ||
                popFirstSeg === 'explore' ||
                popFirstSeg in popPrimaryMap))
          
          // If it's a primary page URL, return empty stack (right panel will close)
          if (isPrimaryPage) {
            return []
          }
          
          // Check if navigating to a note URL (supports both /notes/{id} and /{context}/notes/{id})
          const noteUrlMatch = state.url.match(/\/(discussions|search|profile|home|feed|spells|explore|rss|calendar)\/notes\/(.+)$/) || 
                              state.url.match(/\/notes\/(.+)$/)
          if (noteUrlMatch) {
            const noteId = noteUrlMatch[noteUrlMatch.length - 1].split('?')[0].split('#')[0]
            if (noteId && isSmallScreen) {
              const built = findAndCreateComponent(state.url, state.index)
              if (built.component) {
                return [
                  { index: state.index, url: state.url, component: built.component, ref: built.ref }
                ]
              }
              return syncSecondaryStackWhenPopStateStateIsNull(pre, state.url)
            }
          }
          // Create a new stack item if it's a secondary route (e.g., /mutes)
          const { component, ref } = findAndCreateComponent(state.url, state.index)
          if (component) {
            newStack.push({
              index: state.index,
              url: state.url,
              component,
              ref
            })
          } else {
            return []
          }
        } else if (!topItem.component) {
          // Load the component if it's not cached (e.g. LRU cleared an older stack frame)
          const { component, ref } = findAndCreateComponent(topItem.url, topItem.index)
          if (component) {
            topItem.component = component
            topItem.ref = ref
          }
        }
        if (newStack.length === 0) {
          // DO NOT update URL when closing panel - closing should NEVER affect the main page
        }
        return newStack
      })
    }

    window.addEventListener('popstate', onPopState)

    return () => {
      window.removeEventListener('popstate', onPopState)
    }
  }, [isSmallScreen])

  // Listen for tab state changes from components
  useEffect(() => {
    const handleTabChange = (e: CustomEvent<{ page: TPrimaryPageName, tab: string }>) => {
      currentTabStateRef.current.set(e.detail.page, e.detail.tab)
      logger.debug('PageManager: Tab state updated', { page: e.detail.page, tab: e.detail.tab })
    }
    
    window.addEventListener('pageTabChanged', handleTabChange as EventListener)
    return () => {
      window.removeEventListener('pageTabChanged', handleTabChange as EventListener)
    }
  }, [])

  // Restore tab state when returning to primary page from browser back button
  useEffect(() => {
    if (secondaryStack.length === 0 && currentPrimaryPage) {
      const savedFeedState = savedFeedStateRef.current.get(currentPrimaryPage)
      
      // Restore tab state first
      if (savedFeedState?.tab) {
        logger.info('PageManager: Browser back - Restoring tab state', { page: currentPrimaryPage, tab: savedFeedState.tab })
        window.dispatchEvent(new CustomEvent('restorePageTab', { 
          detail: { page: currentPrimaryPage, tab: savedFeedState.tab } 
        }))
        // Update ref immediately
        currentTabStateRef.current.set(currentPrimaryPage, savedFeedState.tab)
      }
    }
  }, [secondaryStack.length, currentPrimaryPage])

  // Recover when the address bar is a note/profile URL but the stack was cleared (HMR, failed seed, etc.).
  useLayoutEffect(() => {
    const recoverSecondaryStackFromUrl = () => {
      if (secondaryStackRef.current.length > 0) return
      const locUrl = window.location.pathname + window.location.search + window.location.hash
      const pathOnly = locUrl.split('?')[0].split('#')[0]
      if (isPrimaryOnlyPathname(pathOnly)) return

      const synced = syncSecondaryStackWhenPopStateStateIsNull([], locUrl)
      if (synced.length === 0) return
      secondaryStackRef.current = synced
      setSecondaryStack(synced)
    }

    recoverSecondaryStackFromUrl()
    window.addEventListener('popstate', recoverSecondaryStackFromUrl)
    return () => window.removeEventListener('popstate', recoverSecondaryStackFromUrl)
  }, [])

  // Route-level OG / document title for pages that do not set their own (NotePage, ProfilePage handle note/profile).
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (primaryNoteView !== null) return

    const top = secondaryStack[secondaryStack.length - 1]
    let path = window.location.pathname
    if (top?.url) {
      try {
        path = new URL(top.url, window.location.origin).pathname
      } catch {
        /* keep window pathname */
      }
    }

    if (isNoteDetailPathname(path) || isProfileDetailPathname(path)) return

    applyRouteDocumentMeta(path, currentPrimaryPage)
  }, [secondaryStack, currentPrimaryPage, primaryNoteView])

  const navigatePrimaryPage = (page: TPrimaryPageName, props?: any) => {
    const resolvedPage: TPrimaryPageName = (page as string) === 'rss' ? 'feed' : page
    const primaryPageChanging = resolvedPage !== currentPrimaryPageRef.current
    // Clear any primary note view when navigating to a new primary page
    // This ensures menu clicks always take you to the primary page, not stuck on overlays
    setPrimaryNoteView(null)
    
    // Always clear secondary pages when navigating to a primary page via menu
    // This ensures clicking menu items always takes you to that page, not stuck on profile/note pages
    clearSecondaryPages()

    if (primaryPageChanging) {
      client.interruptBackgroundQueries({ closePooledRelayConnections: true })
      noteStatsService.cancelInFlightStatsFetches()
    }
    
    // Update primary pages and current page
    setPrimaryPages((prev) => {
      const exists = prev.find((p) => p.name === resolvedPage)
      if (exists) {
        exists.props = props
        return [...prev]
      }
      return [...prev, { name: resolvedPage, element: getPrimaryPageMap()[resolvedPage], props }]
    })
    setCurrentPrimaryPage(resolvedPage)
    
    // Update URL for primary pages (spells uses ?spell= for faux feeds)
    const newUrl = buildPrimaryPageUrl(resolvedPage, props)
    window.history.pushState(null, '', newUrl)
    
    // NEVER scroll to top - feed should maintain scroll position at all times
  }

  const navigatePrimaryPageStable = useEventCallback(navigatePrimaryPage)

  const goBack = () => {
    if (primaryViewType === 'relay') {
      setPrimaryNoteView(null)
      return
    }
    if (primaryViewType === 'settings-sub') {
      navigatePrimaryPage('settings')
      return
    }
    if (
      primaryViewType === 'bookmarks' ||
      primaryViewType === 'pins' ||
      primaryViewType === 'interests' ||
      primaryViewType === 'user-emojis' ||
      primaryViewType === 'mute' ||
      primaryViewType === 'notification-thread-follow' ||
      primaryViewType === 'notification-thread-mute'
    ) {
      setPrimaryNoteView(null)
      return
    }
    if (
      primaryViewType === 'following' ||
      primaryViewType === 'followers' ||
      primaryViewType === 'others-relay-settings'
    ) {
      const currentPath = window.location.pathname.split('?')[0].split('#')[0]
      const segs = currentPath.split('/').filter(Boolean)
      const profileId = segs[0] === 'users' && segs[1] ? segs[1] : ''
      const profileUrl = `/users/${profileId}`
      window.history.pushState(null, '', profileUrl)
      setPrimaryNoteView(
        suspensePrimaryPage(<SecondaryProfilePageLazy id={profileId} index={0} hideTitlebar={true} />),
        'profile'
      )
      return
    }
    window.history.back()
  }
  goBackRef.current = goBack

  useMobileSwipeBackOnElement(
    isSmallScreen && primaryNoteView ? mobilePrimarySwipeRoot : null,
    () => goBackRef.current(),
    { enabled: Boolean(isSmallScreen && primaryNoteView) }
  )

  const pushSecondaryPage = (url: string, index?: number) => {
    const now = Date.now()
    const recent = recentSecondaryPushRef.current
    if (recent?.url === url && now - recent.at < 400) {
      return
    }
    if (isCurrentPage(secondaryStackRef.current, url)) {
      const top = secondaryStackRef.current[secondaryStackRef.current.length - 1]
      if (top && !top.component) {
        const restored = ensureStackItemComponent(top)
        if (restored.component) {
          const next = [...secondaryStackRef.current.slice(0, -1), restored]
          secondaryStackRef.current = next
          setSecondaryStack(next)
          if (!isSmallScreen) {
            window.history.pushState({ index: restored.index, url }, '', url)
          }
        }
      } else if (!isSmallScreen && top) {
        window.history.pushState({ index: top.index, url }, '', url)
      }
      if (isSmallScreen && top) {
        window.history.pushState({ index: top.index, url }, '', url)
      }
      return
    }
    recentSecondaryPushRef.current = { url, at: now }

    client.interruptBackgroundQueries({ closePooledRelayConnections: true })
    noteStatsService.cancelInFlightStatsFetches()

    if (isSmallScreen && currentPrimaryPage) {
      captureMobilePrimaryFeedScroll(currentPrimaryPage)
    }

    // Small screens overlay the frozen feed; clear full-screen primary overlays so the secondary page shows.
    if (isSmallScreen && primaryNoteView) {
      setPrimaryNoteView(null)
    }

    // Save tab state before navigating
    const currentTab = currentTabStateRef.current.get(currentPrimaryPage)

    if (currentPrimaryPage && currentTab) {
      logger.info('PageManager: Desktop - Saving page state', {
        page: currentPrimaryPage,
        tab: currentTab
      })
      savedFeedStateRef.current.set(currentPrimaryPage, { tab: currentTab })
    }
    
    setSecondaryStack((prevStack) => {
      // For relay pages, clear the stack and start fresh to avoid confusion
      if (
        url.startsWith('/relays/') ||
        url.startsWith('/home/relays/') ||
        url.startsWith('/explore/relays/')
      ) {
        const { newStack, newItem } = pushNewPageToStack([], url, maxStackSize, 0)
        if (newItem) {
          window.history.pushState({ index: newItem.index, url }, '', url)
        }
        logger.component('PageManager', 'secondary push (relay reset)', {
          url,
          stackLength: newStack.length
        })
        return newStack
      }
      
      if (isCurrentPage(prevStack, url)) {
        const top = prevStack[prevStack.length - 1]
        if (top && !top.component) {
          const restored = ensureStackItemComponent(top)
          if (restored.component) {
            if (isSmallScreen) {
              window.history.pushState({ index: restored.index, url }, '', url)
            }
            return [...prevStack.slice(0, -1), restored]
          }
        }
        if (isSmallScreen && top) {
          window.history.pushState({ index: top.index, url }, '', url)
        }
        return prevStack
      }

      const { newStack, newItem } = pushNewPageToStack(prevStack, url, maxStackSize, index)
      logger.component('PageManager', 'secondary push', {
        url,
        stackLength: newStack.length,
        newItemIndex: newItem?.index
      })
      if (newItem) {
        window.history.pushState({ index: newItem.index, url }, '', url)
      } else {
        logger.error('PageManager', 'Failed to create component for URL - component will not be displayed', {
          url,
          path: url.split('?')[0].split('#')[0]
        })
      }
      return newItem ? newStack : prevStack
    })
  }

  const restorePrimaryTabAfterSecondaryClose = () => {
    const page = currentPrimaryPageRef.current
    const savedFeedState = savedFeedStateRef.current.get(page)
    if (savedFeedState?.tab) {
      window.dispatchEvent(
        new CustomEvent('restorePageTab', {
          detail: { page, tab: savedFeedState.tab }
        })
      )
      currentTabStateRef.current.set(page, savedFeedState.tab)
    }
    if (isSmallScreen) {
      const top = peekMobilePrimaryFeedScroll(page)
      requestAnimationFrame(() => {
        window.scrollTo({ top, behavior: 'instant' })
        requestAnimationFrame(() => {
          window.scrollTo({ top, behavior: 'instant' })
        })
      })
    }
  }

  const hardCloseSecondaryPanel = () => {
    if (secondaryStackRef.current.length === 0) {
      return
    }
    secondaryStackRef.current = []
    queueMicrotask(() => {
      setSecondaryStack([])
    })
    replaceHistoryWithPrimaryPageUrl(
      currentPrimaryPageRef.current,
      primaryPagePropsRef.current.get(currentPrimaryPageRef.current) as { spell?: string } | undefined
    )
    restorePrimaryTabAfterSecondaryClose()
  }

  /** Logout / session clear: drop note overlays and replace the current URL (e.g. `/feed/notes/…`) with `/`. */
  const resetToLandingPage = () => {
    ignorePopStateRef.current = true

    setSavedPrimaryPage(null)
    savedPrimaryPagePropsRef.current = undefined
    setPrimaryNoteViewState(null)
    setPrimaryViewType(null)

    noteStatsService.setBackgroundStatsPaused(false)

    secondaryStackRef.current = []
    setSecondaryStack([])

    setPrimaryPages((prev) => {
      if (prev.some((p) => p.name === 'feed')) return prev
      return [...prev, { name: 'feed', element: getPrimaryPageMap().feed }]
    })
    setCurrentPrimaryPage('feed')

    window.history.replaceState(null, '', '/')
  }

  const resetToLandingPageStable = useEventCallback(resetToLandingPage)

  useEffect(() => {
    const onReset = () => resetToLandingPageStable()
    window.addEventListener(APP_RESET_TO_LANDING_EVENT, onReset)
    return () => window.removeEventListener(APP_RESET_TO_LANDING_EVENT, onReset)
  }, [resetToLandingPageStable])

  let lastPopSecondaryPageAt = 0
  const POP_SECONDARY_PAGE_DEBOUNCE_MS = 400

  /** Pop one secondary frame in React state before history.back (popstate can no-op when indices match). */
  const popOneSecondaryStackFrame = () => {
    const pre = secondaryStackRef.current
    if (pre.length <= 1) return pre
    const next = pre.slice(0, -1)
    secondaryStackRef.current = next
    setSecondaryStack(next)
    return next
  }

  const popSecondaryPage = () => {
    const now = Date.now()
    if (now - lastPopSecondaryPageAt < POP_SECONDARY_PAGE_DEBOUNCE_MS) return
    lastPopSecondaryPageAt = now

    navigationCounterRef.current += 1
    if (primaryNoteView) {
      setPrimaryNoteView(null)
    }

    const stackLen = secondaryStackRef.current.length

    if (isSmallScreen) {
      if (stackLen > 1) {
        popOneSecondaryStackFrame()
        ignorePopStateRef.current = true
        window.history.back()
      } else {
        hardCloseSecondaryPanel()
      }
      return
    }

    if (stackLen === 1) {
      secondaryStackRef.current = []
      queueMicrotask(() => {
        setSecondaryStack([])
      })
      replaceHistoryWithPrimaryPageUrl(
        currentPrimaryPage,
        primaryPagePropsRef.current.get(currentPrimaryPage) as { spell?: string } | undefined
      )

      const savedFeedState = savedFeedStateRef.current.get(currentPrimaryPage)

      if (savedFeedState?.tab) {
        logger.info('PageManager: Desktop - Restoring tab state', { page: currentPrimaryPage, tab: savedFeedState.tab })
        window.dispatchEvent(new CustomEvent('restorePageTab', { 
          detail: { page: currentPrimaryPage, tab: savedFeedState.tab } 
        }))
        currentTabStateRef.current.set(currentPrimaryPage, savedFeedState.tab)
      }
    } else if (stackLen > 1) {
      popOneSecondaryStackFrame()
      ignorePopStateRef.current = true
      window.history.back()
    } else {
      replaceHistoryWithPrimaryPageUrl(
        currentPrimaryPage,
        primaryPagePropsRef.current.get(currentPrimaryPage) as { spell?: string } | undefined
      )
    }
  }

  const clearSecondaryPages = () => {
    hardCloseSecondaryPanel()
  }

  popSecondaryPageRef.current = popSecondaryPage

  const mobileSecondaryPanelOpen =
    isSmallScreen && secondaryStack.length > 0 && !primaryNoteView
  useMobileSwipeBackOnElement(mobileSecondaryPanelOpen ? mobileSecondarySwipeRoot : null, () =>
    popSecondaryPageRef.current()
  , {
    enabled: mobileSecondaryPanelOpen
  })

  const primaryObscured =
    secondaryStack.length > 0 || primaryNoteView != null

  const primaryFrozen = primaryObscured

  useLayoutEffect(() => {
    noteStatsService.setBackgroundStatsPaused(primaryObscured)
    if (primaryObscured) {
      extendProfileNetworkDeferral(PROFILE_SECONDARY_PANEL_DEFER_MS)
      client.interruptBackgroundQueries({ closePooledRelayConnections: true })
    }
  }, [primaryObscured])

  const primaryPageContextValue = useMemo(
    (): PrimaryPageContextValue => ({
      navigate: navigatePrimaryPageStable,
      current: currentPrimaryPage,
      currentPageProps,
      /** Feed stays mounted when obscured but timelines pause via `display` + `frozen`. */
      display: !primaryObscured,
      frozen: primaryFrozen
    }),
    [
      navigatePrimaryPageStable,
      currentPrimaryPage,
      currentPageProps,
      primaryObscured,
      primaryFrozen
    ]
  )

  const isSidePanelOpen = secondaryStack.length > 0

  const secondaryPageContextValue = useMemo(
    (): SecondaryPageContextValue => ({
      push: pushSecondaryPage,
      pop: popSecondaryPage,
      currentIndex: secondaryStack.length
        ? secondaryStack[secondaryStack.length - 1].index
        : 0,
      navigateToPrimaryPage: navigatePrimaryPageStable,
      isSidePanelOpen
    }),
    [
      pushSecondaryPage,
      popSecondaryPage,
      secondaryStack,
      navigatePrimaryPageStable,
      isSidePanelOpen
    ]
  )

  return (
    <PrimaryPageContext.Provider value={primaryPageContextValue}>
      {isSmallScreen ? (
        <KeyboardShortcutsHelpProvider>
        <SecondaryPageContext.Provider value={secondaryPageContextValue}>
        <CurrentRelaysProvider>
            <PrimaryNoteViewContext.Provider
              value={{
                setPrimaryNoteView,
                primaryViewType,
                getNavigationCounter: () => navigationCounterRef.current,
                getTopSecondaryUrl: () =>
                  secondaryStack.length > 0 ? secondaryStack[secondaryStack.length - 1].url : undefined,
                registerPrimaryPanelRefresh,
                triggerPrimaryPanelRefresh
              }}
            >
            <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-content-canvas">
            <LiveActivitiesStrip placement="mobile" />
            {primaryNoteView ? (
              // Show primary note view with back button on mobile
              <div
                ref={setMobilePrimarySwipeRoot}
                className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden touch-pan-y"
              >
                <ImwaldBrandBar />
                <div className="flex gap-1 border-b border-border p-1 items-center justify-between font-semibold">
                  <div className="flex min-w-0 flex-1 items-center">
                    <Button
                      className="flex min-w-0 max-w-full gap-1 justify-start pl-2 pr-3"
                      variant="ghost"
                      size="titlebar-icon"
                      title="Back to feed"
                      onClick={goBack}
                    >
                      <ChevronLeft />
                      <div className="app-chrome-title truncate">
                        {primaryViewType === 'settings' || primaryViewType === 'settings-sub'
                          ? 'Settings'
                          : primaryViewType === 'profile'
                            ? 'Back'
                            : getPageTitle(primaryViewType, window.location.pathname)}
                      </div>
                    </Button>
                  </div>
                  <RefreshButton onClick={triggerPrimaryPanelRefresh} />
                </div>
                <div className="page-scroll-y min-h-0 flex-1 basis-0 overflow-y-scroll overscroll-y-contain touch-pan-y">
                  {primaryNoteView}
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden">
                <div
                  className={cn(
                    'flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden',
                    secondaryStack.length > 0 && 'hidden'
                  )}
                  aria-hidden={secondaryStack.length > 0}
                >
                  {renderActivePrimaryPageContent(primaryPages, currentPrimaryPage)}
                </div>
                {secondaryStack.length > 0 ? (
                  <div
                    ref={setMobileSecondarySwipeRoot}
                    className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden touch-pan-y bg-background"
                  >
                    <TopSecondaryStackPane item={secondaryStack[secondaryStack.length - 1]!} />
                  </div>
                ) : null}
              </div>
            )}
            </div>
            <Suspense fallback={null}>
              <BottomNavigationBarLazy />
            </Suspense>
            <Suspense fallback={null}>
              <TooManyRelaysAlertDialogLazy />
            </Suspense>
            <Suspense fallback={null}>
              <PostSignupBackupRedirectLazy />
            </Suspense>
            </PrimaryNoteViewContext.Provider>
        </CurrentRelaysProvider>
        </SecondaryPageContext.Provider>
        </KeyboardShortcutsHelpProvider>
      ) : (
      <KeyboardShortcutsHelpProvider>
      <SecondaryPageContext.Provider value={secondaryPageContextValue}>
        <CurrentRelaysProvider>
            <PrimaryNoteViewContext.Provider
              value={{
                setPrimaryNoteView,
                primaryViewType,
                getNavigationCounter: () => navigationCounterRef.current,
                getTopSecondaryUrl: () =>
                  secondaryStack.length > 0 ? secondaryStack[secondaryStack.length - 1].url : undefined,
                registerPrimaryPanelRefresh,
                triggerPrimaryPanelRefresh
              }}
            >
            <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-content-canvas">
              <div
                className="mx-auto flex h-full min-h-0 w-full max-w-[1920px] flex-1 bg-content-canvas"
              >
                <Suspense fallback={null}>
                  <SidebarLazy />
                </Suspense>
                <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-r border-border">
                    <MainContentArea
                      primaryPages={primaryPages}
                      currentPrimaryPage={currentPrimaryPage}
                      primaryNoteView={primaryNoteView}
                      primaryViewType={primaryViewType}
                      goBack={goBack}
                      onPrimaryPanelRefresh={triggerPrimaryPanelRefresh}
                    />
                  </div>
                  <div className="flex h-full min-h-0 w-[min(1042px,50vw)] shrink-0 flex-col overflow-hidden border-l border-border bg-muted/25 px-2 pt-3 pb-2">
                    {secondaryStack.length > 0 ? (
                      <TopSecondaryStackPane
                        item={secondaryStack[secondaryStack.length - 1]!}
                        className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                      />
                    ) : (
                      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
                        <p>{t('doublePane.secondaryEmpty')}</p>
                        <p className="text-xs opacity-80">{t('doublePane.secondaryEmptyHint')}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <Suspense fallback={null}>
              <TooManyRelaysAlertDialogLazy />
            </Suspense>
            <Suspense fallback={null}>
              <PostSignupBackupRedirectLazy />
            </Suspense>
            </PrimaryNoteViewContext.Provider>
        </CurrentRelaysProvider>
      </SecondaryPageContext.Provider>
      </KeyboardShortcutsHelpProvider>
      )}
    </PrimaryPageContext.Provider>
  )
}

export function SecondaryPageLink({
  to,
  children,
  className,
  onClick
}: {
  to: string
  children: React.ReactNode
  className?: string
  onClick?: (e: React.MouseEvent) => void
}) {
  const { push } = useSecondaryPage()

  return (
    <span
      className={cn('cursor-pointer', className)}
      onClick={(e) => {
        if (onClick) {
          onClick(e)
        }
        push(to)
      }}
    >
      {children}
    </span>
  )
}

/** Re-mount a stack frame when LRU eviction cleared `component` (otherwise the panel is blank). */
function ensureStackItemComponent(item: TStackItem): TStackItem {
  if (item.component) return item
  const { component, ref } = findAndCreateComponent(item.url, item.index)
  if (!component) return item
  return { ...item, component, ref }
}

function isCurrentPage(stack: TStackItem[], url: string) {
  const currentPage = stack[stack.length - 1]
  if (!currentPage) return false

  return (
    currentPage.url === url || secondaryPanelUrlsMatch(currentPage.url, url)
  )
}

/** Route elements are `<Suspense><LazyPage /></Suspense>` — props must be applied to the lazy leaf, not Suspense. */
function cloneSecondaryRouteElement(
  element: ReactElement,
  props: Record<string, unknown>
): ReactElement {
  if (element.type === Suspense) {
    const inner = element.props.children
    if (isValidElement(inner)) {
      return cloneElement(element, undefined, cloneElement(inner, props as any))
    }
  }
  return cloneElement(element, props as any)
}

/** Hex id segment from /notes/{id} or /{context}/notes/{id} (query/hash stripped). */
function noteHexIdFromSecondaryNoteUrl(url: string): string | null {
  const contextual = url.match(
    /\/(?:discussions|search|profile|home|feed|spells|explore|rss|calendar)\/notes\/(.+)$/
  )
  const standard = url.match(/\/notes\/(.+)$/)
  const m = contextual || standard
  return m ? m[m.length - 1].split('?')[0].split('#')[0] : null
}

/** Same secondary destination as /notes/x vs /explore/notes/x (different paths, one note). */
function secondaryPanelUrlsMatch(stackUrl: string, locationUrl: string): boolean {
  if (stackUrl === locationUrl) return true
  const idA = noteHexIdFromSecondaryNoteUrl(stackUrl)
  const idB = noteHexIdFromSecondaryNoteUrl(locationUrl)
  return Boolean(idA && idB && idA === idB)
}

/** `/`, `/feed`, `/explore`, etc. — not `/notes/…`, `/feed/notes/…`, `/relays/…`. */
/** Mount only the top secondary frame so Back unmounts feeds/relays under the previous page. */
function TopSecondaryStackPane({
  item,
  className = 'flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden'
}: {
  item: TStackItem
  className?: string
}) {
  const resolved = ensureStackItemComponent(item)
  return (
    <div key={resolved.index} className={className}>
      {resolved.component}
    </div>
  )
}

function isPrimaryOnlyPathname(pathname: string): boolean {
  const pathOnly = pathname.split('?')[0].split('#')[0]
  const segments = pathOnly.split('/').filter(Boolean)
  const firstSeg = segments[0] ?? ''
  const primaryMap = getPrimaryPageMap()
  return (
    segments.length === 0 ||
    (segments.length === 1 &&
      (firstSeg === 'discussions' ||
        firstSeg === 'home' ||
        firstSeg === 'explore' ||
        firstSeg in primaryMap))
  )
}

/**
 * When popstate has no history state (e.g. after pushState(null, …) on load), the URL still updates
 * but we must realign the secondary stack; otherwise the panel shows a stale page.
 */
function syncSecondaryStackWhenPopStateStateIsNull(pre: TStackItem[], locUrl: string): TStackItem[] {
  const pathOnly = locUrl.split('?')[0].split('#')[0]
  if (isPrimaryOnlyPathname(pathOnly)) {
    return []
  }

  const top = pre[pre.length - 1]
  if (top && secondaryPanelUrlsMatch(top.url, locUrl)) {
    if (!top.component) {
      const restored = ensureStackItemComponent(top)
      if (restored.component) {
        return [...pre.slice(0, -1), restored]
      }
    }
    return pre
  }

  for (let i = pre.length - 1; i >= 0; i--) {
    if (secondaryPanelUrlsMatch(pre[i].url, locUrl)) {
      const newStack = pre.slice(0, i + 1)
      const newTop = newStack[newStack.length - 1]
      if (newTop && !newTop.component) {
        const { component, ref } = findAndCreateComponent(newTop.url, newTop.index)
        if (component) {
          newTop.component = component
          newTop.ref = ref
        }
      }
      return newStack
    }
  }

  const nextIdx = pre.length === 0 ? 0 : Math.max(...pre.map((x) => x.index)) + 1
  const { component, ref } = findAndCreateComponent(locUrl, nextIdx)
  if (!component) {
    return []
  }
  return [{ index: nextIdx, url: locUrl, component, ref }]
}

function findAndCreateComponent(url: string, index: number) {
  const path = url.split('?')[0].split('#')[0]
  const matched = matchAppRoute(path)
  if (!matched?.element) {
    logger.component('PageManager', 'No matching route found', { path, url })
    return {}
  }

  const ref = createRef<TPageRef>()

  // Decode URL parameters for relay pages
  const params = { ...matched.params }
  if (params.url && typeof params.url === 'string') {
    params.url = decodeURIComponent(params.url)
  }

  const noteRouteId = typeof params.id === 'string' ? params.id : undefined
  const initialEvent = noteRouteId ? navigationEventStore.peekEvent(noteRouteId) : undefined
  try {
    const component = cloneSecondaryRouteElement(matched.element, {
      ...params,
      index,
      ref,
      ...(initialEvent ? { initialEvent } : {})
    })
    return { component, ref }
  } catch (error) {
    logger.error('PageManager', 'Error creating component', { error, params })
    return {}
  }
}

function pushNewPageToStack(
  stack: TStackItem[],
  url: string,
  maxStackSize = 5,
  specificIndex?: number
) {
  const currentItem = stack[stack.length - 1]
  const currentIndex = specificIndex ?? (currentItem ? currentItem.index + 1 : 0)

  const { component, ref } = findAndCreateComponent(url, currentIndex)
  if (!component) {
    logger.error('PageManager', 'pushNewPageToStack: No component created', { url, currentIndex, path: url.split('?')[0].split('#')[0] })
    return { newStack: stack, newItem: null }
  }

  const newItem = { component, ref, url, index: currentIndex }
  const prior = stack.map((item) =>
    item.component != null ? { ...item, component: null } : item
  )
  let newStack = [...prior, newItem]
  if (newStack.length > maxStackSize) {
    newStack = newStack.slice(newStack.length - maxStackSize)
  }
  return { newStack, newItem }
}
