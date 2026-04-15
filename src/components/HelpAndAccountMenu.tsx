import LoginDialog from '@/components/LoginDialog'
import LogoutDialog from '@/components/LogoutDialog'
import KeyboardShortcutsHelpSidebarButton from '@/components/Sidebar/KeyboardShortcutsHelpSidebarButton'
import SidebarItem from '@/components/Sidebar/SidebarItem'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
import { useCacheBrowser } from '../contexts/cache-browser-context'
import { useKeyboardShortcutsHelp } from '@/contexts/keyboard-shortcuts-help-context'
import { usePrimaryPage } from '@/contexts/primary-page-context'
import { useFetchProfile } from '@/hooks/useFetchProfile'
import { useNostr } from '@/providers/NostrProvider'
import { ArrowDownUp, CircleHelp, Database, LogIn, LogOut, Settings, User, UserRound } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export type HelpAndAccountMenuVariant = 'sidebar' | 'titlebar'

function AccountDropdownItems({
  onSwitchAccount,
  onLogoutClick,
  includeHelp
}: {
  onSwitchAccount: () => void
  onLogoutClick: () => void
  /** Titlebar (mobile): help lives here so the relay strip has more room. */
  includeHelp?: boolean
}) {
  const { t } = useTranslation()
  const { navigate } = usePrimaryPage()
  const { openBrowseCache } = useCacheBrowser()
  const { openHelp } = useKeyboardShortcutsHelp()

  return (
    <>
      {includeHelp ? (
        <>
          <DropdownMenuItem
            onClick={() => {
              openHelp()
            }}
          >
            <CircleHelp className="size-4" />
            {t('help.title')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      ) : null}
      <DropdownMenuItem onClick={() => navigate('profile')}>
        <User className="size-4" />
        {t('Profile')}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => navigate('settings')}>
        <Settings className="size-4" />
        {t('Settings')}
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => {
          openBrowseCache()
        }}
      >
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
  onLogoutClick
}: {
  onSwitchAccount: () => void
  onLogoutClick: () => void
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
              <AvatarImage src={avatar} />
              <AvatarFallback>
                <img src={defaultAvatar} alt="" />
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
          includeHelp={false}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TitlebarAccountMenu({
  onSwitchAccount,
  onLogoutClick
}: {
  onSwitchAccount: () => void
  onLogoutClick: () => void
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
                <AvatarImage src={resolvedProfile.avatar} className="object-cover object-center" />
                <AvatarFallback>
                  <img src={defaultAvatar} alt="" />
                </AvatarFallback>
              </Avatar>
            )
          ) : (
            <Skeleton className={cn('w-6 h-6 rounded-full', active ? 'ring-primary ring-1' : '')} />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" className="z-[220]">
        <AccountDropdownItems
          onSwitchAccount={onSwitchAccount}
          onLogoutClick={onLogoutClick}
          includeHelp
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Sidebar: help (?) above account. Titlebar (mobile): help is inside the account menu so the relay strip has more room.
 */
export default function HelpAndAccountMenu({ variant }: { variant: HelpAndAccountMenuVariant }) {
  const { t } = useTranslation()
  const { pubkey, checkLogin } = useNostr()
  const { openHelp } = useKeyboardShortcutsHelp()
  const [loginDialogOpen, setLoginDialogOpen] = useState(false)
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false)

  const help = variant === 'sidebar' ? <KeyboardShortcutsHelpSidebarButton /> : null

  let account: ReactNode
  if (pubkey) {
    account =
      variant === 'sidebar' ? (
        <SidebarAccountMenu
          onSwitchAccount={() => setLoginDialogOpen(true)}
          onLogoutClick={() => setLogoutDialogOpen(true)}
        />
      ) : (
        <TitlebarAccountMenu
          onSwitchAccount={() => setLoginDialogOpen(true)}
          onLogoutClick={() => setLogoutDialogOpen(true)}
        />
      )
  } else if (variant === 'sidebar') {
    account = (
      <SidebarItem onClick={() => checkLogin()} title="Login">
        <LogIn strokeWidth={3} />
      </SidebarItem>
    )
  } else {
    account = (
      <Button variant="ghost" size="titlebar-icon" onClick={() => checkLogin()} title={t('Login')}>
        <UserRound />
      </Button>
    )
  }

  const wrapClass =
    variant === 'titlebar' ? 'flex shrink-0 items-center gap-1' : 'flex flex-col space-y-2'

  /** Logged-out titlebar: keep ? next to login so help stays reachable without opening login. */
  const titlebarHelpWhenLoggedOut =
    variant === 'titlebar' && !pubkey ? (
      <Button
        type="button"
        variant="ghost"
        size="titlebar-icon"
        onClick={() => openHelp()}
        title={t('help.title')}
        aria-label={t('help.title')}
      >
        <CircleHelp />
      </Button>
    ) : null

  return (
    <>
      <div className={wrapClass}>
        {help}
        {titlebarHelpWhenLoggedOut}
        {account}
      </div>
      <LoginDialog open={loginDialogOpen} setOpen={setLoginDialogOpen} />
      <LogoutDialog open={logoutDialogOpen} setOpen={setLogoutDialogOpen} />
    </>
  )
}
