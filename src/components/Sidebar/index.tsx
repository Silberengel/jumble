import Icon from '@/assets/Icon'
import Logo from '@/assets/Logo'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import HelpAndAccountMenu from '@/components/HelpAndAccountMenu'
import FeedButton from './FeedButton'
import HomeButton from './HomeButton'
import NotificationButton from './NotificationButton'
import PostButton from './PostButton'
import RssButton from './RssButton'
import SearchButton from './SearchButton'
import FavoritesButton from './FavoritesButton'
import SpellsButton from './SpellsButton'
import { ConnectedRelaysSidebarStrip } from '@/components/ConnectedRelays/ConnectedRelaysSidebarStrip'
import { FavoriteRelaysActiveStripSidebar } from '@/components/FavoriteRelaysActiveStrip'
import PaneModeToggle from './PaneModeToggle'
import DownloadDesktopSidebarButton from './DownloadDesktopSidebarButton'
import LiveActivitiesStrip from '@/components/LiveActivitiesStrip'
import SidebarCalendarWeekWidget from './SidebarCalendarWeekWidget'
import { ReadOnlySessionIndicator } from '@/components/ReadOnlySessionIndicator'

export default function PrimaryPageSidebar() {
  const { isSmallScreen } = useScreenSize()
  if (isSmallScreen) return null

  return (
    <div className="imwald-sidebar flex h-full min-h-0 w-[4.8rem] shrink-0 flex-col overflow-hidden pb-2 pt-4 px-2 xl:w-[15.6rem] xl:pl-4 xl:pr-6">
      <div className="imwald-sidebar__atmosphere" aria-hidden />
      <div className="relative z-[1] flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 space-y-2 overflow-x-hidden overflow-y-auto overscroll-contain">
          <div className="mb-6 w-full min-w-0 shrink-0">
            <Icon className="mx-auto xl:hidden" />
            {/* Full-bleed banner at xl: span entire sidebar column (undo pl-4 + pr-6) */}
            <div className="max-xl:hidden -ml-4 -mr-6 w-[calc(100%+2.5rem)] min-w-0">
              <Logo className="h-auto max-h-[5.5rem] w-full max-w-full object-contain object-center" />
            </div>
          </div>
          <ReadOnlySessionIndicator variant="sidebar" />
          <HomeButton />
          <FeedButton />
          <NotificationButton />
          <SearchButton />
          <FavoritesButton />
          <SpellsButton />
          <RssButton />
          <FavoriteRelaysActiveStripSidebar />
          <ConnectedRelaysSidebarStrip />
          <PostButton />
          <div className="max-xl:hidden w-full min-w-0 space-y-2 px-1">
            <LiveActivitiesStrip placement="sidebar" />
            <SidebarCalendarWeekWidget />
          </div>
        </div>
        <div className="shrink-0 space-y-2 pt-2">
          <HelpAndAccountMenu variant="sidebar" />
          <PaneModeToggle />
          <DownloadDesktopSidebarButton />
        </div>
      </div>
    </div>
  )
}
