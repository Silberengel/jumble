import {
  getCanonicalPaytoType,
  getPaytoEditorTypeLabel,
  getPaytoIconChar,
  getPaytoLogoPath,
  isLightningPaytoType
} from '@/lib/payto'
import { cn } from '@/lib/utils'
import { Zap as ZapIcon } from 'lucide-react'

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
  const logoPath = getPaytoLogoPath(canonical)
  const iconChar = getPaytoIconChar(canonical)
  const isLightning = isLightningPaytoType(canonical)

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md border border-border/60 bg-muted/40',
        'px-1.5 py-0.5 text-xs font-medium leading-none text-muted-foreground',
        className
      )}
    >
      {logoPath ? (
        <img src={logoPath} alt="" className="size-3.5 shrink-0 object-contain" aria-hidden />
      ) : isLightning ? (
        <ZapIcon className="size-3.5 shrink-0 text-yellow-400" strokeWidth={2} aria-hidden />
      ) : iconChar ? (
        <span className="shrink-0 text-[0.65rem] leading-none" aria-hidden>
          {iconChar}
        </span>
      ) : null}
      <span className="truncate">{label}</span>
    </span>
  )
}
