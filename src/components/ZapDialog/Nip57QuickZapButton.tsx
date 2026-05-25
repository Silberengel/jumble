import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { superchatLightningAccentClass } from '@/lib/superchat-ui'
import { cn } from '@/lib/utils'
import { Zap } from 'lucide-react'

export default function Nip57QuickZapButton({
  label,
  zapping,
  onClick,
  className
}: {
  label: string
  zapping: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <Button
      type="button"
      className={cn('mb-3 w-full justify-start gap-2', className)}
      onClick={onClick}
      disabled={zapping}
    >
      {zapping ? (
        <Skeleton className="size-4 shrink-0 rounded-full" aria-hidden />
      ) : (
        <Zap className={cn('size-4 shrink-0', superchatLightningAccentClass)} aria-hidden />
      )}
      <span className="min-w-0 truncate">{label}</span>
    </Button>
  )
}
