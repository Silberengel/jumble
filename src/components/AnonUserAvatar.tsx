import { cn } from '@/lib/utils'
import { UserRound } from 'lucide-react'

export function AnonUserAvatar({
  size = 'small',
  className
}: {
  size?: 'small' | 'medium'
  className?: string
}) {
  const dim = size === 'small' ? 'size-8' : 'size-10'
  const icon = size === 'small' ? 'size-4' : 'size-5'
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border/60',
        dim,
        className
      )}
      aria-hidden
    >
      <UserRound className={icon} strokeWidth={2} />
    </div>
  )
}
