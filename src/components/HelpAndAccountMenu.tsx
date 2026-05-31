import LoginDialog from '@/components/LoginDialog'
import LogoutDialog from '@/components/LogoutDialog'
import SidebarItem from '@/components/Sidebar/SidebarItem'
import { Avatar, AvatarFallback, AvatarIdenticon, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { formatPubkey, formatNpub, generateImageByPubkey, pubkeyToNpub } from '@/lib/pubkey'
import { isVideo } from '@/lib/url'
import { cn } from '@/lib/utils'
import { openBrowseCacheFromRegistry } from '@/contexts/cache-browser-context'
import { toCacheSettings } from '@/lib/link'
import { usePrimaryPage } from '@/contexts/primary-page-context'
import { useSmartSettingsNavigation } from '@/PageManager'
import { useFetchProfile } from '@/hooks/useFetchProfile'
import { useNostr } from '@/providers/NostrProvider'
import { ActiveRelaysDropdownSection } from '@/components/ConnectedRelays/ActiveRelaysDropdownSection'
import { useRelayConnectionRows } from '@/hooks/useRelayConnectionRows'
import { ArrowDownUp, Database, LogIn, LogOut, Settings, User, UserRound } from 'lucide-react'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

const titlebarAccountMenuContentClassName =
  'z-[220] w-[min(18rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain'

export type HelpAndAccountMenuVariant = 'sidebar' | 'titlebar'

function AccountDropdownItems({
  onSwitchAccount,
  onLogoutClick,
  onBrowseCache
}: {
  onSwitchAccount: () => void
  onLogoutClick: () => void
  onBrowseCache: () => void
}) {
  const { t } = useTranslation()
  const { navigate } = usePrimaryPage()

  return (
    <>
      <DropdownMenuItem onClick={() => navigate('profile')}>
        <User className="size-4" />
        {t('Profile')}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => navigate('settings')}>
        <Settings className="size-4" />
        {t('Settings')}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onBrowseCache}>
        <Database className="size-4" />
        {t('Browse Cache')}
      </DropdownMenuItem>
      <ActiveRelaysDropdownSection />
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={onSwitchAccount}>
        <ArrowDownUp className="size-4" />
        {t('Switch account')}
      </DropdownMenuItem>
      <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onLogoutClick}>
        <LogOut className="size-4" />
        {t('Logout')}
      </DropdownMenuItem>
    </>
  )
}

function SidebarAccountMenu({
  onSwitchAccount,
  onLogoutClick,
  onBrowseCache
}: {
  onSwitchAccount: () => void
  onLogoutClick: () => void
  onBrowseCache: () => void
}) {
  const { t } = useTranslation()
  const { account, profile } = useNostr()
  const { current, display } = usePrimaryPage()
  const pubkey = account?.pubkey
  const { profile: fetchedProfile } = useFetchProfile(pubkey)
  const active = useMemo(() => current === 'profile' && display, [display, current])

  if (!pubkey) return null

  const defaultAvatar = generateImageByPubkey(pubkey)
  const npub = pubkeyToNpub(pubkey)
  const fallbackUsername = npub ? formatNpub(npub) : formatPubkey(pubkey)
  const resolvedProfile = fetchedProfile ?? profile
  const { username, avatar } = resolvedProfile || { username: fallbackUsername, avatar: defaultAvatar }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          title={t('Account menu')}
          aria-label={t('Account menu')}
          className={cn(
            'clickable h-12 min-w-0 justify-start gap-2 rounded-lg bg-transparent p-2 text-lg font-semibold text-foreground shadow-none hover:text-accent-foreground',
            'w-12 xl:w-full xl:px-2 xl:py-2',
            active && 'bg-accent/50'
          )}
        >
          {isVideo(avatar ?? '') ? (
            <div className="size-8 shrink-0 overflow-hidden rounded-full">
              <video src={avatar} className="h-full w-full object-cover object-center" autoPlay muted loop playsInline />
            </div>
          ) : (
            <Avatar className="size-8 shrink-0">
              <AvatarImage src={avatar || defaultAvatar} className="object-cover object-center" />
              <AvatarFallback delayMs={0}>
                <AvatarIdenticon src={defaultAvatar} />
              </AvatarFallback>
            </Avatar>
          )}
          <span className="truncate max-xl:hidden">{username}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="z-[220]">
        <AccountDropdownItems
          onSwitchAccount={onSwitchAccount}
          onLogoutClick={onLogoutClick}
          onBrowseCache={onBrowseCache}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TitlebarAccountMenu({
  onSwitchAccount,
  onLogoutClick,
  onBrowseCache
}: {
  onSwitchAccount: () => void
  onLogoutClick: () => void
  onBrowseCache: () => void
}) {
  const { t } = useTranslation()
  const { account, profile } = useNostr()
  const pubkey = account?.pubkey
  const { profile: fetchedProfile } = useFetchProfile(pubkey)
  const resolvedProfile = fetchedProfile ?? profile
  const { current, display } = usePrimaryPage()
  const defaultAvatar = useMemo(
    () => (resolvedProfile?.pubkey ? generateImageByPubkey(resolvedProfile.pubkey) : ''),
    [resolvedProfile]
  )
  const active = useMemo(() => current === 'profile' && display, [display, current])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="titlebar-icon"
          className={cn(active ? 'bg-accent/50' : '')}
          title={t('Account menu')}
          aria-label={t('Account menu')}
        >
          {resolvedProfile ? (
            isVideo(resolvedProfile.avatar ?? '') ? (
              <div className={cn('w-6 h-6 overflow-hidden rounded-full', active ? 'ring-primary ring-1' : '')}>
                <video src={resolvedProfile.avatar} className="h-full w-full object-cover object-center" autoPlay muted loop playsInline />
              </div>
            ) : (
              <Avatar className={cn('w-6 h-6', active ? 'ring-primary ring-1' : '')}>
                <AvatarImage
                  src={resolvedProfile.avatar || defaultAvatar}
                  className="object-cover object-center"
                />
                <AvatarFallback delayMs={0}>
                  <AvatarIdenticon src={defaultAvatar} />
                </AvatarFallback>
              </Avatar>
            )
          ) : (
            <Skeleton className={cn('w-6 h-6 rounded-full', active ? 'ring-primary ring-1' : '')} />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" className={titlebarAccountMenuContentClassName}>
        <AccountDropdownItems
          onSwitchAccount={onSwitchAccount}
          onLogoutClick={onLogoutClick}
          onBrowseCache={onBrowseCache}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function LoggedOutTitlebarMenu({ onLogin }: { onLogin: () => void }) {
  const { t } = useTranslation()
  const { rows } = useRelayConnectionRows()

  if (rows.length === 0) {
    return (
      <Button variant="ghost" size="titlebar-icon" onClick={onLogin} title={t('Login')}>
        <UserRound />
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="titlebar-icon" title={t('Login')} aria-label={t('Login')}>
          <UserRound />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" className={titlebarAccountMenuContentClassName}>
        <DropdownMenuItem onClick={onLogin}>
          <LogIn className="size-4" />
          {t('Login')}
        </DropdownMenuItem>
        <ActiveRelaysDropdownSection />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Sidebar: account / login stack. Titlebar (mobile): compact account or login control. */
export default function HelpAndAccountMenu({ variant }: { variant: HelpAndAccountMenuVariant }) {
  const { pubkey, checkLogin } = useNostr()
  const { navigateToSettings } = useSmartSettingsNavigation()
  const onBrowseCache = useCallback(() => {
    if (!openBrowseCacheFromRegistry()) {
      navigateToSettings(toCacheSettings())
    }
  }, [navigateToSettings])
  const [loginDialogOpen, setLoginDialogOpen] = useState(false)
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false)

  let account: ReactNode
  if (pubkey) {
    account =
      variant === 'sidebar' ? (
        <SidebarAccountMenu
          onSwitchAccount={() => setLoginDialogOpen(true)}
          onLogoutClick={() => setLogoutDialogOpen(true)}
          onBrowseCache={onBrowseCache}
        />
      ) : (
        <TitlebarAccountMenu
          onSwitchAccount={() => setLoginDialogOpen(true)}
          onLogoutClick={() => setLogoutDialogOpen(true)}
          onBrowseCache={onBrowseCache}
        />
      )
  } else if (variant === 'titlebar') {
    account = <LoggedOutTitlebarMenu onLogin={() => checkLogin()} />
  } else {
    account = (
      <SidebarItem onClick={() => checkLogin()} title="Login">
        <LogIn strokeWidth={3} />
      </SidebarItem>
    )
  }

  const wrapClass =
    variant === 'titlebar' ? 'flex shrink-0 items-center gap-1' : 'flex flex-col space-y-2'

  return (
    <>
      <div className={wrapClass}>
        {account}
      </div>
      <LoginDialog open={loginDialogOpen} setOpen={setLoginDialogOpen} />
      <LogoutDialog open={logoutDialogOpen} setOpen={setLogoutDialogOpen} />
    </>
  )
}
