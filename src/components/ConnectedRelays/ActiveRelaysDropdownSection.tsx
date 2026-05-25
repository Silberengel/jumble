import { useSmartRelayNavigation } from '@/PageManager'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { useRelayConnectionRows } from '@/hooks/useRelayConnectionRows'
import { toRelay } from '@/lib/link'
import { simplifyUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import RelayIcon from '../RelayIcon'

function rowMuted(connected: boolean) {
  return !connected
}

function rowTitle(url: string, connected: boolean, t: (k: string) => string) {
  const base = simplifyUrl(url)
  if (!connected) return `${base} — ${t('Not connected')}`
  return base
}

function rowClass(connected: boolean) {
  return cn(rowMuted(connected) && 'opacity-45 text-muted-foreground')
}

/** Relay list block for account (or similar) dropdown menus. */
export function ActiveRelaysDropdownSection() {
  const { t } = useTranslation()
  const { navigateToRelay } = useSmartRelayNavigation()
  const { rows, connectedCount } = useRelayConnectionRows()

  if (rows.length === 0) return null

  const countSummary = `${connectedCount}/${rows.length}`

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="flex items-baseline justify-between gap-2 text-xs font-normal">
        <span>{t('Active relays')}</span>
        <span className="tabular-nums text-muted-foreground">{countSummary}</span>
      </DropdownMenuLabel>
      {rows.map(({ url, connected }) => (
        <DropdownMenuItem
          key={url}
          title={rowTitle(url, connected, t)}
          onClick={() => navigateToRelay(toRelay(url))}
          className={cn('min-w-52 gap-2', rowClass(connected))}
        >
          <RelayIcon url={url} />
          {simplifyUrl(url)}
        </DropdownMenuItem>
      ))}
    </>
  )
}
