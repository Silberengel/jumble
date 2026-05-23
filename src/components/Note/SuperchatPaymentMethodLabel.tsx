import { getCanonicalPaytoType, getPaytoEditorTypeLabel } from '@/lib/payto'
import PaytoTypeIcon from '@/components/PaytoTypeIcon'
import { cn } from '@/lib/utils'

export default function SuperchatPaymentMethodLabel({
  paytoType,
  className
}: {
  /** Canonical or alias payto type (`lightning`, `monero`, `geyser`, …). */
  paytoType: string
  className?: string
}) {
  const canonical = getCanonicalPaytoType(paytoType)
  const label = getPaytoEditorTypeLabel(canonical)

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border/60 bg-muted/40',
        'px-2 py-1 text-sm font-semibold leading-none text-muted-foreground',
        className
      )}
    >
      <PaytoTypeIcon type={paytoType} />
      <span className="truncate">{label}</span>
    </span>
  )
}
