import { Button } from '@/components/ui/button'
import { DrawerClose } from '@/components/ui/drawer'
import { cn } from '@/lib/utils'

/** Large-font / accessibility: wrap labels, top-align icons, scrollable sheet padding. */
export const drawerMenuButtonClassName =
  'flex h-auto min-h-0 w-full items-start justify-start gap-3 whitespace-normal px-4 py-3 text-left text-base leading-snug [&_svg]:size-5 [&_svg]:shrink-0'

export const drawerMenuContentClassName =
  'flex max-h-[min(90dvh,calc(100dvh-1rem))] flex-col overflow-hidden'

export const drawerMenuScrollClassName =
  'min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pt-2 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]'

export default function DrawerMenuItem({
  children,
  className,
  onClick
}: {
  children: React.ReactNode
  className?: string
  onClick?: (e: React.MouseEvent) => void
}) {
  return (
    <DrawerClose className="w-full">
      <Button
        onClick={onClick}
        className={cn(drawerMenuButtonClassName, className)}
        variant="ghost"
      >
        {children}
      </Button>
    </DrawerClose>
  )
}
