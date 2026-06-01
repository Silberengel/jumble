import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

export type RelaySettingsKindNoticeVariant = 'edit' | 'view' | 'session'

type Props = {
  kinds: readonly number[]
  variant?: RelaySettingsKindNoticeVariant
  className?: string
}

function formatKindList(kinds: readonly number[]): string {
  return kinds.join(', ')
}

export default function RelaySettingsKindNotice({
  kinds,
  variant = 'edit',
  className
}: Props) {
  const { t } = useTranslation()

  if (variant === 'session') {
    return (
      <p
        className={cn(
          'rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground',
          className
        )}
        role="note"
      >
        {t('relaySettingsEventKindsSession')}
      </p>
    )
  }

  if (kinds.length === 0) return null

  const kindsLabel = formatKindList(kinds)
  const body =
    variant === 'view'
      ? t('relaySettingsEventKindsView', { kinds: kindsLabel })
      : kinds.length === 1
        ? t('relaySettingsEventKindsEditOne', { kind: kindsLabel })
        : t('relaySettingsEventKindsEditMany', { kinds: kindsLabel })

  return (
    <p
      className={cn(
        'rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground',
        className
      )}
      role="note"
    >
      <span className="font-medium text-foreground">{t('relaySettingsEventKindsLabel')}:</span>{' '}
      <span className="font-mono tabular-nums">{kindsLabel}</span>
      <span className="block mt-1">{body}</span>
    </p>
  )
}
