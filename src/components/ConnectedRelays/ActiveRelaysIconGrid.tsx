import { useSmartRelayNavigation } from '@/PageManager'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useRelayConnectionRows } from '@/hooks/useRelayConnectionRows'
import { toRelay } from '@/lib/link'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import RelayIcon from '../RelayIcon'
import {
  ACTIVE_RELAYS_MAX_ICONS,
  activeRelayRowMuted,
  activeRelayRowTitle
} from './active-relays-display'

/**
 * Compact relay status: icon buttons only (no hostname labels).
 */
export function ActiveRelaysIconGrid({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { navigateToRelay } = useSmartRelayNavigation()
  const { rows } = useRelayConnectionRows()
  const shown = rows.slice(0, ACTIVE_RELAYS_MAX_ICONS)
  const overflowRows = rows.slice(ACTIVE_RELAYS_MAX_ICONS)
  const overflow = overflowRows.length

  if (rows.length === 0) {
    return (
      <p className={cn('text-xs text-muted-foreground', className)} title={t('Active relays')}>
        —
      </p>
    )
  }

  return (
    <div className={cn('flex flex-wrap gap-1', className)} title={t('Active relays')}>
      {shown.map(({ url, connected }) => (
        <Button
          key={url}
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            'h-7 w-7 min-h-7 min-w-7 shrink-0 rounded-full p-0 hover:bg-muted/80',
            activeRelayRowMuted(connected) && 'opacity-40 grayscale'
          )}
          title={activeRelayRowTitle(url, connected, t)}
          aria-label={activeRelayRowTitle(url, connected, t)}
          onClick={() => navigateToRelay(toRelay(url))}
        >
          <RelayIcon url={url} className="h-6 w-6" iconSize={12} />
        </Button>
      ))}
      {overflow > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 min-h-7 min-w-7 shrink-0 rounded-full bg-muted px-1.5 py-0 text-[0.65rem] font-medium tabular-nums text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              title={t('More relays', { count: overflow })}
              aria-label={t('More relays', { count: overflow })}
            >
              +{overflow}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="right"
            className="w-auto max-w-[min(18rem,calc(100vw-1.5rem))] p-2"
          >
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground py-1">
              {t('More relays', { count: overflow })}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div className="flex flex-wrap gap-1 max-w-[16rem]">
              {overflowRows.map(({ url, connected }) => (
                <Button
                  key={url}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-7 w-7 min-h-7 min-w-7 shrink-0 rounded-full p-0 hover:bg-muted/80',
                    activeRelayRowMuted(connected) && 'opacity-40 grayscale'
                  )}
                  title={activeRelayRowTitle(url, connected, t)}
                  aria-label={activeRelayRowTitle(url, connected, t)}
                  onClick={() => navigateToRelay(toRelay(url))}
                >
                  <RelayIcon url={url} className="h-6 w-6" iconSize={12} />
                </Button>
              ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}
