import { cn } from '@/lib/utils'
import { useFavoriteRelaysActivity } from '@/providers/favorite-relays-activity-context'
import { RelayPulseActiveNpubsOpenButton } from './RelayPulseActiveNpubsSheet'
import { useTranslation } from 'react-i18next'

export { relativePastPhrase, useRelativePastPhrase } from './relay-pulse-relative-time'

/** Home feed / mobile: compact row above the page title (no section label — opens sheet for detail). */
export function FavoriteRelaysActiveStripMobileBar({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { totalCount, loading, relayActivityReady } = useFavoriteRelaysActivity()

  if (!relayActivityReady && !loading) {
    return (
      <div
        className={cn(
          'w-full min-w-0 max-w-full border-b border-border/60 bg-muted/15 px-3 py-1.5 sm:px-4 animate-pulse',
          className
        )}
        aria-hidden
      >
        <div className="ml-auto h-7 w-28 rounded-md bg-muted/50" />
      </div>
    )
  }

  if (relayActivityReady && !loading && totalCount === 0) {
    return (
      <div
        className={cn(
          'w-full min-w-0 max-w-full border-b border-border/60 bg-muted/20 px-3 py-1.5 sm:px-4',
          className
        )}
      >
        <p className="text-xs text-muted-foreground leading-snug">{t('Relay pulse empty')}</p>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex w-full min-w-0 max-w-full items-center justify-end border-b border-border/60 bg-muted/15 px-3 py-1.5 sm:px-4',
        loading && 'animate-pulse',
        className
      )}
    >
      <RelayPulseActiveNpubsOpenButton size="sm" variant="outline" className="h-7 shrink-0 max-w-full" />
    </div>
  )
}

/** Desktop sidebar: compact row under nav */
export function FavoriteRelaysActiveStripSidebar({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { totalCount, loading, relayActivityReady } = useFavoriteRelaysActivity()

  if (!relayActivityReady && !loading) {
    return (
      <div className={cn('px-1 py-2 xl:px-0 animate-pulse', className)}>
        <p className="text-[0.65rem] font-medium leading-snug text-foreground">{t('Relay pulse')}</p>
        <div className="mt-0.5 h-4 w-16 rounded bg-muted/50" aria-hidden />
      </div>
    )
  }

  if (relayActivityReady && !loading && totalCount === 0) {
    return (
      <div className={cn('hidden px-1 py-2 xl:block xl:px-0', className)}>
        <div className="flex flex-wrap items-center gap-1.5 px-1">
          <p className="text-[0.65rem] font-medium leading-snug text-foreground">{t('Relay pulse')}</p>
          <RelayPulseActiveNpubsOpenButton size="icon" variant="ghost" className="size-7 shrink-0" />
        </div>
        <p className="mt-1 px-1 text-[0.65rem] leading-snug text-muted-foreground">
          {t('Relay pulse empty')}
        </p>
      </div>
    )
  }

  return (
    <div className={cn('px-1 py-2 xl:px-0', loading && 'animate-pulse', className)}>
      <div className="max-xl:hidden mb-0.5 flex flex-wrap items-center gap-1 px-1">
        <p className="min-w-0 flex-1 text-[0.65rem] font-medium leading-snug text-foreground">
          {t('Relay pulse')}
        </p>
        <div className="flex shrink-0 items-center gap-0.5">
          <RelayPulseActiveNpubsOpenButton size="icon" variant="ghost" className="size-7 shrink-0" />
        </div>
      </div>
      <div className="mb-1 flex justify-center gap-0.5 xl:hidden">
        <RelayPulseActiveNpubsOpenButton size="icon" variant="ghost" className="size-8 shrink-0" />
      </div>
    </div>
  )
}
