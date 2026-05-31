import RelayIcon from '@/components/RelayIcon'
import { Button } from '@/components/ui/button'
import { toRelay } from '@/lib/link'
import { simplifyUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import { useSmartRelayNavigation } from '@/PageManager'
import { useTranslation } from 'react-i18next'

export function FeedRelaysIconRow({
  urls,
  className
}: {
  urls: readonly string[]
  className?: string
}) {
  const { t } = useTranslation()
  const { navigateToRelay } = useSmartRelayNavigation()
  if (urls.length === 0) return null

  return (
    <div
      className={cn('flex min-w-0 flex-wrap items-center gap-1', className)}
      role="group"
      aria-label={t('Feed relays', { defaultValue: 'Relays in this feed' })}
    >
      {urls.map((url) => {
        const label = simplifyUrl(url)
        return (
          <Button
            key={url}
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 min-h-7 min-w-7 shrink-0 rounded-full p-0 hover:bg-muted/80"
            title={label}
            aria-label={t('Open relay feed', { relay: label, defaultValue: `Open ${label} feed` })}
            onClick={() => navigateToRelay(toRelay(url))}
          >
            <RelayIcon url={url} className="h-6 w-6" iconSize={12} />
          </Button>
        )
      })}
    </div>
  )
}
