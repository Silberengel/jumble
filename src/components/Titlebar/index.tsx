import { cn } from '@/lib/utils'

export function Titlebar({
  children,
  className,
  hideBottomBorder = false
}: {
  children?: React.ReactNode
  className?: string
  hideBottomBorder?: boolean
}) {
  return (
    <div
      className={cn(
        'imwald-titlebar-fog sticky top-0 z-40 flex w-full min-h-12 shrink-0 flex-col justify-center overflow-visible bg-background py-1.5 [&_svg]:size-5 [&_svg]:shrink-0 select-none',
        !hideBottomBorder && 'border-b border-border',
        className
      )}
    >
      {children}
    </div>
  )
}
