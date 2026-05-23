import { getCanonicalPaytoType, getPaytoEditorTypeLabel } from '@/lib/payto'
import PaytoTypeIcon from '@/components/PaytoTypeIcon'
import { cn } from '@/lib/utils'

export default function SuperchatPaymentMethodLabel({
  paytoType,
  className,
  imgClassName,
  iconOnly = false
}: {
  /** Canonical or alias payto type (`lightning`, `monero`, `geyser`, …). */
  paytoType: string
  className?: string
  imgClassName?: string
  /** Profile wall: icon only (label in `title` for hover). */
  iconOnly?: boolean
}) {
  const canonical = getCanonicalPaytoType(paytoType)
  const label = getPaytoEditorTypeLabel(canonical)

  return (
    <span
      title={iconOnly ? label : undefined}
      className={cn(
        'inline-flex shrink-0 items-center rounded-md border border-border/60 bg-muted/40',
        iconOnly
          ? 'p-1.5 leading-none text-muted-foreground'
          : 'gap-1.5 px-2 py-1 text-sm font-semibold leading-none text-muted-foreground',
        className
      )}
    >
      <PaytoTypeIcon type={paytoType} imgClassName={imgClassName} />
      {iconOnly ? null : <span className="truncate">{label}</span>}
    </span>
  )
}
