import {
  getCanonicalPaytoType,
  getPaytoIconChar,
  getPaytoLogoPath,
  isLightningPaytoType
} from '@/lib/payto'
import { superchatLightningAccentClass } from '@/lib/superchat-ui'
import { cn } from '@/lib/utils'
import { HelpCircle, Zap as ZapIcon } from 'lucide-react'

export default function PaytoTypeIcon({
  type,
  className,
  imgClassName
}: {
  type: string
  className?: string
  imgClassName?: string
}) {
  const canonical = getCanonicalPaytoType(type)
  const logoPath = getPaytoLogoPath(canonical)
  const iconChar = getPaytoIconChar(canonical)
  const isLightning = isLightningPaytoType(canonical)

  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center leading-none', className)}
      aria-hidden
    >
      {isLightning ? (
        <ZapIcon
          className={cn('size-4 shrink-0', superchatLightningAccentClass, imgClassName)}
          strokeWidth={2}
        />
      ) : logoPath ? (
        <img src={logoPath} alt="" className={cn('size-4 object-contain', imgClassName)} />
      ) : iconChar != null ? (
        <span className="inline-flex items-center justify-center text-[1rem] leading-none">
          {iconChar}
        </span>
      ) : (
        <HelpCircle className={cn('size-3.5 text-muted-foreground', imgClassName)} />
      )}
    </span>
  )
}
