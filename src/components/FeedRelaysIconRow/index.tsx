import RelayIcon from '@/components/RelayIcon'
import { simplifyUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

export function FeedRelaysIconRow({
  urls,
  className
}: {
  urls: readonly string[]
  className?: string
}) {
  const { t } = useTranslation()
  if (urls.length === 0) return null

  return (
    <div
      className={cn('flex min-w-0 flex-wrap items-center gap-1', className)}
      role="group"
      aria-label={t('Feed relays', { defaultValue: 'Relays in this feed' })}
    >
      {urls.map((url) => (
        <span
          key={url}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          title={simplifyUrl(url)}
        >
          <RelayIcon url={url} className="h-6 w-6" iconSize={12} />
        </span>
      ))}
    </div>
  )
}
