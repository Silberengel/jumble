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
import {
  accountPubkeyToHex,
  formatPubkey,
  formatNpub,
  generateImageByPubkey,
  hexPubkeysEqual,
  pubkeyToNpub
} from '@/lib/pubkey'
import { isVideo } from '@/lib/url'
import { cn } from '@/lib/utils'
import { openBrowseCacheFromRegistry } from '@/contexts/cache-browser-context'
import { toCacheSettings } from '@/lib/link'
import { usePrimaryPage } from '@/contexts/primary-page-context'
import { useSmartSettingsNavigation } from '@/PageManager'
import { useFetchProfile } from '@/hooks/useFetchProfile'
import { useNostr } from '@/providers/NostrProvider'
import { AccountQuickSwitchMenuItems } from '@/components/AccountQuickSwitchMenuItems'
import { AnonUserAvatar } from '@/components/AnonUserAvatar'
import { ReadOnlySessionIndicator } from '@/components/ReadOnlySessionIndicator'
import UserStatusBadge from '@/components/UserStatusBadge'
import { ArrowDownUp, Database, LogIn, LogOut, Settings, User, UserRound } from 'lucide-react'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TProfile } from '@/types'

/** Profile for the badge only when it belongs to the active session pubkey (avoids stale name/avatar). */
function profileForActivePubkey(
  pubkey: string | undefined,
  nostrProfile: TProfile | null,
  fetchedProfile: TProfile | null
): TProfile | null {
  const pk = pubkey ? accountPubkeyToHex(pubkey) : null
  if (!pk) return null
  if (fetchedProfile && hexPubkeysEqual(fetchedProfile.pubkey, pk)) return fetchedProfile
  if (nostrProfile && hexPubkeysEqual(nostrProfile.pubkey, pk)) return nostrProfile
  return null
}

const titlebarAccountMenuContentClassName =
  'z-[220] w-[min(18rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain'

export type HelpAndAccountMenuVariant = 'sidebar' | 'titlebar'

function AccountDropdownItems({
  onSwitchAccount,
  onLogoutClick,
  onBrowseCache,
  onCloseMenu
}: {
  onSwitchAccount: () => void
  onLogoutClick: () => void
  onBrowseCache: () => void
  onCloseMenu?: () => void
}) {
  const { t } = useTranslation()
  const { navigate } = usePrimaryPage()
  const { isAnonSession } = useNostr()
  const anonIdentityDisabled = t('accountSwitch.anonIdentityDisabled')

  return (
    <>
      <ReadOnlySessionIndicator variant="menu" />
      <AccountQuickSwitchMenuItems onAfterSwitch={onCloseMenu} />
      <DropdownMenuItem
        disabled={isAnonSession}
        title={isAnonSession ? anonIdentityDisabled : undefined}
        onClick={() => {
          if (isAnonSession) return
          navigate('profile')
        }}
      >
        <User className="size-4" />
        {t('Profile')}
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={isAnonSession}
        title={isAnonSession ? anonIdentityDisabled : undefined}
        onClick={() => {
          if (isAnonSession) return
          navigate('settings')
        }}
      >
        <Settings className="size-4" />
        {t('Settings')}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onBrowseCache}>
        <Database className="size-4" />
        {t('Browse Cache')}
      </DropdownMenuItem>
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
  const { account, profile, isAnonSession } = useNostr()
  const { current, display } = usePrimaryPage()
  const [menuOpen, setMenuOpen] = useState(false)
  const pubkey = account?.pubkey
  const { profile: fetchedProfile } = useFetchProfile(isAnonSession ? undefined : pubkey)
  const resolvedProfile = useMemo(
    () => (isAnonSession ? null : profileForActivePubkey(pubkey, profile, fetchedProfile)),
    [pubkey, profile, fetchedProfile, isAnonSession]
  )
  const active = useMemo(() => current === 'profile' && display, [display, current])

  if (!pubkey && !isAnonSession) return null

  const defaultAvatar = pubkey ? generateImageByPubkey(pubkey) : ''
  const npub = pubkey ? pubkeyToNpub(pubkey) : null
  const fallbackUsername = npub ? formatNpub(npub) : pubkey ? formatPubkey(pubkey) : t('accountSwitch.anon')
  const { username, avatar } = resolvedProfile
    ? { username: resolvedProfile.username, avatar: resolvedProfile.avatar ?? defaultAvatar }
    : { username: fallbackUsername, avatar: defaultAvatar }

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          title={t('Account menu')}
          aria-label={t('Account menu')}
          className={cn(
            'clickable flex min-w-0 items-center justify-start gap-2 rounded-lg bg-transparent p-2 text-lg font-semibold text-foreground shadow-none hover:text-accent-foreground',
            'h-12 w-12 shrink-0 xl:h-auto xl:min-h-12 xl:w-full xl:py-2',
            active && 'bg-accent/50'
          )}
        >
          {isAnonSession ? (
            <AnonUserAvatar size="medium" className="size-8 shrink-0" />
          ) : isVideo(avatar ?? '') ? (
            <div className="size-8 shrink-0 overflow-hidden rounded-full">
              <video src={avatar} className="h-full w-full object-cover object-center" autoPlay muted loop playsInline />
            </div>
          ) : (
            <Avatar className="size-8 shrink-0" key={pubkey}>
              <AvatarImage src={avatar || defaultAvatar} className="object-cover object-center" />
              <AvatarFallback delayMs={0}>
                <AvatarIdenticon src={defaultAvatar} />
              </AvatarFallback>
            </Avatar>
          )}
          <span className="flex min-w-0 max-xl:hidden flex-col items-start gap-0.5 truncate">
            <span className="truncate w-full">{isAnonSession ? t('accountSwitch.anon') : username}</span>
            {!isAnonSession && pubkey ? (
              <UserStatusBadge userId={pubkey} className="w-full text-[11px]" quiet />
            ) : null}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="z-[220]">
        <AccountDropdownItems
          onSwitchAccount={onSwitchAccount}
          onLogoutClick={onLogoutClick}
          onBrowseCache={onBrowseCache}
          onCloseMenu={() => setMenuOpen(false)}
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
  const { account, profile, isAnonSession } = useNostr()
  const pubkey = account?.pubkey
  const { profile: fetchedProfile } = useFetchProfile(isAnonSession ? undefined : pubkey)
  const resolvedProfile = useMemo(
    () => (isAnonSession ? null : profileForActivePubkey(pubkey, profile, fetchedProfile)),
    [pubkey, profile, fetchedProfile, isAnonSession]
  )
  const { current, display } = usePrimaryPage()
  const [menuOpen, setMenuOpen] = useState(false)
  const defaultAvatar = useMemo(
    () => (resolvedProfile?.pubkey ? generateImageByPubkey(resolvedProfile.pubkey) : ''),
    [resolvedProfile]
  )
  const active = useMemo(() => current === 'profile' && display, [display, current])

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="titlebar-icon"
          className={cn(active ? 'bg-accent/50' : '')}
          title={t('Account menu')}
          aria-label={t('Account menu')}
        >
          {isAnonSession ? (
            <AnonUserAvatar size="small" className="size-6" />
          ) : resolvedProfile ? (
            isVideo(resolvedProfile.avatar ?? '') ? (
              <div className={cn('w-6 h-6 overflow-hidden rounded-full', active ? 'ring-primary ring-1' : '')}>
                <video src={resolvedProfile.avatar} className="h-full w-full object-cover object-center" autoPlay muted loop playsInline />
              </div>
            ) : (
              <Avatar className={cn('w-6 h-6', active ? 'ring-primary ring-1' : '')} key={pubkey}>
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
          onCloseMenu={() => setMenuOpen(false)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function LoggedOutTitlebarMenu({ onLogin }: { onLogin: () => void }) {
  const { t } = useTranslation()

  return (
    <Button variant="ghost" size="titlebar-icon" onClick={onLogin} title={t('Login')}>
      <UserRound />
    </Button>
  )
}

/** Sidebar: account / login stack. Titlebar (mobile): compact account or login control. */
export default function HelpAndAccountMenu({ variant }: { variant: HelpAndAccountMenuVariant }) {
  const { pubkey, checkLogin, isNip07LoginInFlight, isAnonSession } = useNostr()
  const { navigateToSettings } = useSmartSettingsNavigation()
  const onBrowseCache = useCallback(() => {
    if (!openBrowseCacheFromRegistry()) {
      navigateToSettings(toCacheSettings())
    }
  }, [navigateToSettings])
  const [loginDialogOpen, setLoginDialogOpen] = useState(false)
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false)

  let account: ReactNode
  if (pubkey || isAnonSession) {
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
      <LoginDialog
        open={loginDialogOpen}
        setOpen={setLoginDialogOpen}
        blockClose={isNip07LoginInFlight}
      />
      <LogoutDialog open={logoutDialogOpen} setOpen={setLogoutDialogOpen} />
    </>
  )
}
