import { useSecondaryPage } from '@/PageManager'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerOverlay } from '@/components/ui/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useRelayConnectionRows } from '@/hooks/useRelayConnectionRows'
import { toRelay } from '@/lib/link'
import { simplifyUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { Server } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import RelayIcon from '../RelayIcon'

function rowMuted(connected: boolean, sessionStriked: boolean) {
  return !connected || sessionStriked
}

function rowTitle(
  url: string,
  connected: boolean,
  sessionStriked: boolean,
  t: (k: string) => string
) {
  const base = simplifyUrl(url)
  if (sessionStriked) return `${base} — ${t('Relay session striked')}`
  if (!connected) return `${base} — ${t('Not connected')}`
  return base
}

/**
 * Same interaction pattern as {@link SeenOnButton}: Server + counts, menu lists relays with {@link RelayIcon}.
 * Shows favorites + default/inbox relays; disconnected or session-striked relays are muted.
 */
export function ActiveRelaysTitlebarButton() {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { push } = useSecondaryPage()
  const { rows, connectedCount } = useRelayConnectionRows()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const trigger = (
    <Button
      variant="ghost"
      size="titlebar-icon"
      className="shrink-0 gap-0.5 text-muted-foreground hover:text-primary disabled:opacity-40"
      title={t('Active relays')}
      aria-label={t('Active relays')}
      disabled={rows.length === 0}
      onClick={() => {
        if (isSmallScreen) setDrawerOpen(true)
      }}
    >
      <Server className="size-5 shrink-0" />
      {rows.length > 0 ? (
        <span className="text-xs tabular-nums leading-none">
          <span className="text-foreground">{connectedCount}</span>
          <span className="text-muted-foreground">/{rows.length}</span>
        </span>
      ) : null}
    </Button>
  )

  const rowClass = (connected: boolean, sessionStriked: boolean) =>
    cn(rowMuted(connected, sessionStriked) && 'opacity-45 text-muted-foreground')

  if (isSmallScreen) {
    return (
      <>
        {trigger}
        <Drawer handleOnly open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DrawerOverlay onClick={() => setDrawerOpen(false)} />
          <DrawerContent
            hideOverlay
            dragHandle="vaul"
            className="flex max-h-[min(85dvh,32rem)] flex-col gap-0"
          >
            <DrawerHeader className="sr-only">
              <DrawerTitle>{t('Active relays')}</DrawerTitle>
            </DrawerHeader>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-2 pb-4">
              {rows.map(({ url, connected, sessionStriked }) => (
                <Button
                  className={cn('h-auto w-full justify-start gap-3 p-4 text-base', rowClass(connected, sessionStriked))}
                  variant="ghost"
                  key={url}
                  title={rowTitle(url, connected, sessionStriked, t)}
                  onClick={() => {
                    setDrawerOpen(false)
                    setTimeout(() => push(toRelay(url)), 50)
                  }}
                >
                  <RelayIcon url={url} />
                  {simplifyUrl(url)}
                </Button>
              ))}
            </div>
          </DrawerContent>
        </Drawer>
      </>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('Active relays')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {rows.map(({ url, connected, sessionStriked }) => (
          <DropdownMenuItem
            key={url}
            title={rowTitle(url, connected, sessionStriked, t)}
            onClick={() => push(toRelay(url))}
            className={cn('min-w-52 gap-2', rowClass(connected, sessionStriked))}
          >
            <RelayIcon url={url} />
            {simplifyUrl(url)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
