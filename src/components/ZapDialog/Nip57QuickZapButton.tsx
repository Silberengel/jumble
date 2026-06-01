import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { superchatLightningAccentClass } from '@/lib/superchat-ui'
import { cn } from '@/lib/utils'
import { Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function Nip57QuickZapButton({
  label,
  zapping,
  onClick,
  onCancel,
  className
}: {
  label: string
  zapping: boolean
  onClick: () => void
  onCancel: () => void
  className?: string
}) {
  const { t } = useTranslation()

  if (zapping) {
    return (
      <div className={cn('mb-3 flex gap-2', className)}>
        <Button type="button" className="min-w-0 flex-1 justify-start gap-2" disabled>
          <Skeleton className="size-4 shrink-0 rounded-full" aria-hidden />
          <span className="min-w-0 truncate">{label}</span>
        </Button>
        <Button type="button" variant="outline" className="shrink-0" onClick={onCancel}>
          {t('Cancel')}
        </Button>
      </div>
    )
  }

  return (
    <Button
      type="button"
      className={cn('mb-3 w-full justify-start gap-2', className)}
      onClick={onClick}
    >
      <Zap className={cn('size-4 shrink-0', superchatLightningAccentClass)} aria-hidden />
      <span className="min-w-0 truncate">{label}</span>
    </Button>
  )
}
