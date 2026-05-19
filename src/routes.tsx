import { match } from 'path-to-regexp'
import {
  isValidElement,
  lazy,
  Suspense,
  type ComponentType,
  type LazyExoticComponent,
  type ReactElement
} from 'react'

/** Lazy + Suspense so importing `routes` does not sync-pull pages that depend on PageManager (breaks Vite HMR cycles). */
const FollowingListPageLazy = lazy(() => import('./pages/secondary/FollowingListPage'))
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
const NotePageLazy = lazy(() => import('./pages/secondary/NotePage'))
const OthersRelaySettingsPageLazy = lazy(() => import('./pages/secondary/OthersRelaySettingsPage'))
const PostSettingsPageLazy = lazy(() => import('./pages/secondary/PostSettingsPage'))
const ProfileEditorPageLazy = lazy(() => import('./pages/secondary/ProfileEditorPage'))
const ProfileListPageLazy = lazy(() => import('./pages/secondary/ProfileListPage'))
const ProfilePageLazy = lazy(() => import('./pages/secondary/ProfilePage'))
const RelayPageLazy = lazy(() => import('./pages/secondary/RelayPage'))
const RelayReviewsPageLazy = lazy(() => import('./pages/secondary/RelayReviewsPage'))
const RelaySettingsPageLazy = lazy(() => import('./pages/secondary/RelaySettingsPage'))
const CacheSettingsPageLazy = lazy(() => import('./pages/secondary/CacheSettingsPage'))
const RssFeedSettingsPageLazy = lazy(() => import('./pages/secondary/RssFeedSettingsPage'))
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

const routeSuspenseFallback = null

function SR(C: LazyExoticComponent<ComponentType<any>>): ReactElement {
  return (
    <Suspense fallback={routeSuspenseFallback}>
      <C />
    </Suspense>
  )
}

const ROUTES = [
  { path: '/notes', element: SR(NoteListPageLazy) },
  { path: '/notes/:id', element: SR(NotePageLazy) },
  { path: '/discussions/notes/:id', element: SR(NotePageLazy) },
  { path: '/search/notes/:id', element: SR(NotePageLazy) },
  { path: '/profile/notes/:id', element: SR(NotePageLazy) },
  { path: '/explore/notes/:id', element: SR(NotePageLazy) },
  { path: '/home/notes/:id', element: SR(NotePageLazy) },
  { path: '/feed/notes/:id', element: SR(NotePageLazy) },
  { path: '/spells/notes/:id', element: SR(NotePageLazy) },
  { path: '/rss/notes/:id', element: SR(NotePageLazy) },
  { path: '/calendar/notes/:id', element: SR(NotePageLazy) },
  { path: '/calendar/day/:ymd', element: SR(CalendarDayEventsPageLazy) },
  { path: '/rss-item/:articleKey', element: SR(RssArticlePageLazy) },
  { path: '/rss/rss-item/:articleKey', element: SR(RssArticlePageLazy) },
  { path: '/feed/rss-item/:articleKey', element: SR(RssArticlePageLazy) },
  { path: '/search/rss-item/:articleKey', element: SR(RssArticlePageLazy) },
  { path: '/profile/rss-item/:articleKey', element: SR(RssArticlePageLazy) },
  { path: '/spells/rss-item/:articleKey', element: SR(RssArticlePageLazy) },
  { path: '/explore/rss-item/:articleKey', element: SR(RssArticlePageLazy) },
  { path: '/home/rss-item/:articleKey', element: SR(RssArticlePageLazy) },
  { path: '/users', element: SR(ProfileListPageLazy) },
  { path: '/users/:id/following', element: SR(FollowingListPageLazy) },
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
  { path: '/settings/rss-feeds', element: SR(RssFeedSettingsPageLazy) },
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
