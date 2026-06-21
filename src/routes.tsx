import { match } from 'path-to-regexp'
import {
  isValidElement,
  lazy,
  Suspense,
  type ComponentType,
  type LazyExoticComponent,
  type ReactElement
} from 'react'
import NotePageRoute from './pages/secondary/NotePage/NotePageRoute'

/** Lazy + Suspense so importing `routes` does not sync-pull pages that depend on PageManager (breaks Vite HMR cycles). */
const FollowingListPageLazy = lazy(() => import('./pages/secondary/FollowingListPage'))
const FollowersListPageLazy = lazy(() => import('./pages/secondary/FollowersListPage'))
const GeneralSettingsPageLazy = lazy(() => import('./pages/secondary/GeneralSettingsPage'))
const MuteListPageLazy = lazy(() => import('./pages/secondary/MuteListPage'))
const BookmarkListPageLazy = lazy(() => import('./pages/secondary/BookmarkListPage'))
const NotificationThreadFollowListPageLazy = lazy(() =>
  import('./pages/secondary/NotificationThreadWatchListPage').then((m) => ({
    default: m.NotificationThreadFollowListPage
  }))
)
const NotificationThreadMuteListPageLazy = lazy(() =>
  import('./pages/secondary/NotificationThreadWatchListPage').then((m) => ({
    default: m.NotificationThreadMuteListPage
  }))
)
const PinListPageLazy = lazy(() => import('./pages/secondary/PinListPage'))
const ProfileBadgesListPageLazy = lazy(() => import('./pages/secondary/ProfileBadgesListPage'))
const InterestListPageLazy = lazy(() => import('./pages/secondary/InterestListPage'))
const NoteListPageLazy = lazy(() => import('./pages/secondary/NoteListPage'))
const OthersRelaySettingsPageLazy = lazy(() => import('./pages/secondary/OthersRelaySettingsPage'))
const PostSettingsPageLazy = lazy(() => import('./pages/secondary/PostSettingsPage'))
const ProfileEditorPageLazy = lazy(() => import('./pages/secondary/ProfileEditorPage'))
const ProfileListPageLazy = lazy(() => import('./pages/secondary/ProfileListPage'))
const ProfilePageLazy = lazy(() => import('./pages/secondary/ProfilePage'))
const RelayPageLazy = lazy(() => import('./pages/secondary/RelayPage'))
const RelayReviewsPageLazy = lazy(() => import('./pages/secondary/RelayReviewsPage'))
const RelaySettingsPageLazy = lazy(() => import('./pages/secondary/RelaySettingsPage'))
const CacheSettingsPageLazy = lazy(() => import('./pages/secondary/CacheSettingsPage'))
const FollowSetsSettingsPageLazy = lazy(() => import('./pages/secondary/FollowSetsSettingsPage'))
const PersonalListsSettingsPageLazy = lazy(() => import('./pages/secondary/PersonalListsSettingsPage'))
const UserEmojiListPageLazy = lazy(() => import('./pages/secondary/UserEmojiListPage'))
const EmojiSetsSettingsPageLazy = lazy(() => import('./pages/secondary/EmojiSetsSettingsPage'))
const SearchPageLazy = lazy(() => import('./pages/secondary/SearchPage'))
const SettingsPageLazy = lazy(() => import('./pages/secondary/SettingsPage'))
const WalletPageLazy = lazy(() => import('./pages/secondary/WalletPage'))
const FollowPacksRedirectLazy = lazy(() => import('./pages/secondary/FollowPacksRedirect'))
const RssArticlePageLazy = lazy(() => import('./pages/secondary/RssArticlePage'))
const CalendarDayEventsPageLazy = lazy(() => import('./pages/secondary/CalendarDayEventsPage'))
const ComposerPageRouteLazy = lazy(() => import('./pages/secondary/ComposerPage/ComposerPageRoute'))

const routeSuspenseFallback = null

function SR(C: LazyExoticComponent<ComponentType<any>>): ReactElement {
  return (
    <Suspense fallback={routeSuspenseFallback}>
      <C />
    </Suspense>
  )
}

const notePageElement = <NotePageRoute />
const noteListPageElement = SR(NoteListPageLazy)
const rssArticlePageElement = SR(RssArticlePageLazy)
const composerPageElement = SR(ComposerPageRouteLazy)

/** Primary segments used in contextual `/…/notes/:id` and `/…/rss-item/:key` routes. */
const CONTEXTUAL_ROUTE_PREFIXES =
  'discussions|search|library|profile|home|feed|spells|explore|rss|calendar'

const contextualNotePathRe = new RegExp(
  `^/(${CONTEXTUAL_ROUTE_PREFIXES})/notes/([^/?#]+)$`
)
const standardNotePathRe = /^\/notes\/([^/?#]+)$/
const contextualRssItemPathRe = new RegExp(
  `^/(${CONTEXTUAL_ROUTE_PREFIXES})/rss-item/([^/?#]+)$`
)
const standardRssItemPathRe = /^\/rss-item\/([^/?#]+)$/

const ROUTES = [
  { path: '/compose', element: composerPageElement },
  { path: '/compose/reply/:id', element: composerPageElement },
  { path: '/compose/options', element: composerPageElement },
  { path: '/notes', element: noteListPageElement },
  { path: '/notes/:id', element: notePageElement },
  { path: '/discussions/notes/:id', element: notePageElement },
  { path: '/search/notes/:id', element: notePageElement },
  { path: '/library/notes/:id', element: notePageElement },
  { path: '/profile/notes/:id', element: notePageElement },
  { path: '/explore/notes/:id', element: notePageElement },
  { path: '/home/notes/:id', element: notePageElement },
  { path: '/feed/notes/:id', element: notePageElement },
  { path: '/spells/notes/:id', element: notePageElement },
  { path: '/rss/notes/:id', element: notePageElement },
  { path: '/calendar/notes/:id', element: notePageElement },
  { path: '/calendar/day/:ymd', element: SR(CalendarDayEventsPageLazy) },
  { path: '/rss-item/:articleKey', element: rssArticlePageElement },
  { path: '/rss/rss-item/:articleKey', element: rssArticlePageElement },
  { path: '/feed/rss-item/:articleKey', element: rssArticlePageElement },
  { path: '/search/rss-item/:articleKey', element: rssArticlePageElement },
  { path: '/profile/rss-item/:articleKey', element: rssArticlePageElement },
  { path: '/spells/rss-item/:articleKey', element: rssArticlePageElement },
  { path: '/explore/rss-item/:articleKey', element: rssArticlePageElement },
  { path: '/home/rss-item/:articleKey', element: rssArticlePageElement },
  { path: '/users', element: SR(ProfileListPageLazy) },
  { path: '/users/:id/following', element: SR(FollowingListPageLazy) },
  { path: '/users/:id/followers', element: SR(FollowersListPageLazy) },
  { path: '/users/:id/relays', element: SR(OthersRelaySettingsPageLazy) },
  { path: '/users/:id', element: SR(ProfilePageLazy) },
  { path: '/relays/:url/reviews', element: SR(RelayReviewsPageLazy) },
  { path: '/relays/:url', element: SR(RelayPageLazy) },
  { path: '/home/relays/:url', element: SR(RelayPageLazy) },
  { path: '/explore/relays/:url', element: SR(RelayPageLazy) },
  { path: '/search', element: SR(SearchPageLazy) },
  { path: '/settings', element: SR(SettingsPageLazy) },
  { path: '/settings/relays', element: SR(RelaySettingsPageLazy) },
  { path: '/settings/cache', element: SR(CacheSettingsPageLazy) },
  { path: '/settings/wallet', element: SR(WalletPageLazy) },
  { path: '/settings/posts', element: SR(PostSettingsPageLazy) },
  { path: '/settings/general', element: SR(GeneralSettingsPageLazy) },
  { path: '/settings/follow-sets', element: SR(FollowSetsSettingsPageLazy) },
  { path: '/settings/emoji-sets', element: SR(EmojiSetsSettingsPageLazy) },
  { path: '/settings/personal-lists', element: SR(PersonalListsSettingsPageLazy) },
  { path: '/profile-editor', element: SR(ProfileEditorPageLazy) },
  { path: '/mutes', element: SR(MuteListPageLazy) },
  { path: '/bookmarks', element: SR(BookmarkListPageLazy) },
  { path: '/notification-thread-follow', element: SR(NotificationThreadFollowListPageLazy) },
  { path: '/notification-thread-mute', element: SR(NotificationThreadMuteListPageLazy) },
  { path: '/pins', element: SR(PinListPageLazy) },
  { path: '/profile-badges', element: SR(ProfileBadgesListPageLazy) },
  { path: '/interests', element: SR(InterestListPageLazy) },
  { path: '/user-emojis', element: SR(UserEmojiListPageLazy) },
  { path: '/follow-packs', element: SR(FollowPacksRedirectLazy) }
]

export const routes = ROUTES.map(({ path, element }) => ({
  path,
  element: isValidElement(element) ? element : null,
  matcher: match(path)
}))

export type TMatchedAppRoute = {
  element: ReactElement | null
  params: Record<string, string>
}

/**
 * Resolve secondary-panel routes without scanning the full table for common deep links
 * (contextual note / RSS article URLs are tried first; everything else falls back to matchers).
 */
export function matchAppRoute(pathname: string): TMatchedAppRoute | null {
  const path = pathname.split('?')[0].split('#')[0]

  const ctxNote = contextualNotePathRe.exec(path)
  if (ctxNote) {
    return { element: notePageElement, params: { id: ctxNote[2]! } }
  }
  const stdNote = standardNotePathRe.exec(path)
  if (stdNote) {
    return { element: notePageElement, params: { id: stdNote[1]! } }
  }

  const ctxRss = contextualRssItemPathRe.exec(path)
  if (ctxRss) {
    return { element: rssArticlePageElement, params: { articleKey: ctxRss[2]! } }
  }
  const stdRss = standardRssItemPathRe.exec(path)
  if (stdRss) {
    return { element: rssArticlePageElement, params: { articleKey: stdRss[1]! } }
  }

  for (const { matcher, element } of routes) {
    const m = matcher(path)
    if (m) {
      return { element, params: (m as { params: Record<string, string> }).params }
    }
  }
  return null
}
