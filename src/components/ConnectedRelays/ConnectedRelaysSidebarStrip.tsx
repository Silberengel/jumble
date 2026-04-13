import { useSecondaryPage } from '@/PageManager'
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

function rowMuted(connected: boolean, sessionStriked: boolean) {
  return !connected || sessionStriked
}

function rowMenuClass(connected: boolean, sessionStriked: boolean) {
  return cn(rowMuted(connected, sessionStriked) && 'opacity-50 text-muted-foreground')
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
 * Desktop sidebar: relay avatars for favorites + defaults + inbox; muted when the pool socket is down.
 */
export function ConnectedRelaysSidebarStrip({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
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
        {shown.map(({ url, connected, sessionStriked }) => (
          <span
            key={url}
            title={rowTitle(url, connected, sessionStriked, t)}
            className={cn('inline-flex', rowMuted(connected, sessionStriked) && 'opacity-40 grayscale')}
          >
            <RelayIcon url={url} className="h-5 w-5" iconSize={11} />
          </span>
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
              {overflowRows.map(({ url, connected, sessionStriked }) => (
                <DropdownMenuItem
                  key={url}
                  className={cn('min-w-0 gap-2', rowMenuClass(connected, sessionStriked))}
                  title={rowTitle(url, connected, sessionStriked, t)}
                  onClick={() => push(toRelay(url))}
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
