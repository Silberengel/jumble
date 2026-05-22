import { useSmartRelayNavigation } from '@/PageManager'
import { Button } from '@/components/ui/button'
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
import { useTranslation } from 'react-i18next'
import RelayIcon from '../RelayIcon'

const MAX_ICONS = 14

function rowMuted(connected: boolean) {
  return !connected
}

function rowMenuClass(connected: boolean) {
  return cn(rowMuted(connected) && 'opacity-50 text-muted-foreground')
}

function rowTitle(url: string, connected: boolean, t: (k: string) => string) {
  const base = simplifyUrl(url)
  if (!connected) return `${base} — ${t('Not connected')}`
  return base
}

/**
 * Desktop sidebar: relay avatars for favorites, inbox, cache, HTTP index, and defaults;
 * muted when the WebSocket is down (HTTP index relays count as active when configured).
 */
export function ConnectedRelaysSidebarStrip({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { navigateToRelay } = useSmartRelayNavigation()
  const { rows } = useRelayConnectionRows()
  const shown = rows.slice(0, MAX_ICONS)
  const overflowRows = rows.slice(MAX_ICONS)
  const overflow = overflowRows.length

  if (rows.length === 0) {
    return (
      <div className={cn('px-1 py-1.5 xl:px-0', className)} title={t('Active relays')}>
        <p className="text-center text-[0.6rem] font-medium text-muted-foreground xl:text-left">{t('Active relays')}</p>
        <p className="mt-0.5 text-center text-[0.55rem] text-muted-foreground/80 xl:text-left">—</p>
      </div>
    )
  }

  return (
    <div className={cn('px-1 py-2 xl:px-0', className)} title={t('Active relays')}>
      <p className="mb-1.5 text-center text-[0.65rem] font-medium leading-snug text-foreground xl:text-left">
        {t('Active relays')}
      </p>
      <div className="flex flex-wrap justify-center gap-1 xl:justify-start">
        {shown.map(({ url, connected }) => (
          <Button
            key={url}
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'h-5 w-5 min-h-5 min-w-5 shrink-0 rounded-full p-0 hover:bg-muted/80',
              rowMuted(connected) && 'opacity-40 grayscale'
            )}
            title={rowTitle(url, connected, t)}
            aria-label={rowTitle(url, connected, t)}
            onClick={() => navigateToRelay(toRelay(url))}
          >
            <RelayIcon url={url} className="h-5 w-5" iconSize={11} />
          </Button>
        ))}
        {overflow > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-5 min-h-5 min-w-5 shrink-0 rounded-full bg-muted px-1 py-0 text-[0.6rem] font-medium tabular-nums text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                title={t('More relays', { count: overflow })}
                aria-label={t('More relays', { count: overflow })}
              >
                +{overflow}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="right" className="max-h-[min(70vh,24rem)] w-72 overflow-y-auto">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                {t('More relays', { count: overflow })}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {overflowRows.map(({ url, connected }) => (
                <DropdownMenuItem
                  key={url}
                  className={cn('min-w-0 gap-2', rowMenuClass(connected))}
                  title={rowTitle(url, connected, t)}
                  onClick={() => navigateToRelay(toRelay(url))}
                >
                  <RelayIcon url={url} className="h-5 w-5 shrink-0" iconSize={11} />
                  <span className="truncate">{simplifyUrl(url)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  )
}
