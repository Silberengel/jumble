import { getCanonicalPaytoType, getPaytoEditorTypeLabel, paytoTypeHasDisplayIcon } from '@/lib/payto'
import PaytoTypeIcon from '@/components/PaytoTypeIcon'
import { cn } from '@/lib/utils'

export default function SuperchatPaymentMethodLabel({
  paytoType,
  className,
  imgClassName
}: {
  /** Canonical or alias payto type (`lightning`, `monero`, `geyser`, …). */
  paytoType: string
  className?: string
  imgClassName?: string
  /** @deprecated Icon-only when a logo/lightning/symbol exists; text label only as fallback. */
  iconOnly?: boolean
}) {
  const canonical = getCanonicalPaytoType(paytoType)
  const label = getPaytoEditorTypeLabel(canonical)
  const showIconOnly = paytoTypeHasDisplayIcon(canonical)

  return (
    <span
      title={showIconOnly ? label : undefined}
      aria-label={showIconOnly ? label : undefined}
      className={cn(
        'inline-flex shrink-0 items-center rounded-md border border-border/60 bg-muted/40',
        showIconOnly
          ? 'p-1.5 leading-none text-muted-foreground'
          : 'gap-1.5 px-2 py-1 text-sm font-semibold leading-none text-muted-foreground',
        className
      )}
    >
      <PaytoTypeIcon type={paytoType} imgClassName={imgClassName} />
      {showIconOnly ? null : <span className="truncate">{label}</span>}
    </span>
  )
}
