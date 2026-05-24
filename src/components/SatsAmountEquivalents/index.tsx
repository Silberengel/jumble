import { formatSatsEquivalentsParts } from '@/lib/sats-fiat'
import { cn } from '@/lib/utils'
import { useSatsFiatRates } from '@/hooks/useSatsFiatRates'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/** Subtle USD / BTC / XMR equivalents for a sats amount (live spot rates). */
export default function SatsAmountEquivalents({
  sats,
  className,
  id
}: {
  sats: number
  className?: string
  /** Optional id for `aria-describedby` on the sats input. */
  id?: string
}) {
  const { t } = useTranslation()
  const { btcUsd, xmrUsd } = useSatsFiatRates()
  const parts = useMemo(
    () => formatSatsEquivalentsParts(sats, btcUsd, xmrUsd),
    [sats, btcUsd, xmrUsd]
  )

  const line = [parts.usd ?? '—', parts.btc, parts.xmr ?? '—'].join(' · ')

  return (
    <p
      id={id}
      className={cn('text-xs leading-snug tabular-nums text-muted-foreground/90', className)}
      aria-live="polite"
    >
      <span className="sr-only">{t('Approximate equivalent:')} </span>
      <span aria-hidden>≈ </span>
      {line}
    </p>
  )
}
