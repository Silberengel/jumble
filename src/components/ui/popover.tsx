import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'

import { DialogContext } from '@/components/ui/dialog'
import {
  floatingPanelMaxWidthClass,
  floatingPanelScrollClass,
  popoverMaxHeightClass
} from '@/lib/menu-popover-layout'
import { cn } from '@/lib/utils'

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverAnchor = PopoverPrimitive.Anchor

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 4, ...props }, ref) => {
  const inDialog = React.useContext(DialogContext)
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={16}
        className={cn(
          'w-[min(18rem,calc(100vw-1.5rem))] rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          floatingPanelScrollClass,
          popoverMaxHeightClass,
          floatingPanelMaxWidthClass,
          inDialog ? 'z-[290]' : 'z-[110]',
          className
        )}
        onOpenAutoFocus={(e) => e.preventDefault()}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
})
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
