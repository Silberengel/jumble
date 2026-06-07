import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { preloadEmojiPicker } from '@/lib/emoji-picker-preload'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { TEmoji } from '@/types'
import { useCallback, useEffect, useState } from 'react'
import EmojiPicker from '../EmojiPicker'

export default function EmojiPickerDialog({
  children,
  onEmojiClick,
  portalContainer
}: {
  children: React.ReactNode
  onEmojiClick?: (emoji: string | TEmoji | undefined) => void
  /** When set (e.g. inside a modal), picker content portals here so it stays on top of the modal */
  portalContainer?: HTMLElement | null
}) {
  const { isSmallScreen } = useScreenSize()
  const [open, setOpen] = useState(false)
  /** Keep picker mounted after first open so emoji-picker-element is not cold-started every time. */
  const [pickerMounted, setPickerMounted] = useState(false)

  useEffect(() => {
    if (open) setPickerMounted(true)
  }, [open])

  useEffect(() => {
    void preloadEmojiPicker()
  }, [])

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next)
  }, [])

  if (isSmallScreen) {
    return (
      <Drawer
        open={open}
        onOpenChange={handleOpenChange}
        handleOnly
        shouldScaleBackground={false}
        repositionInputs={false}
      >
        <DrawerTrigger asChild>{children}</DrawerTrigger>
        <DrawerContent
          dragHandle="vaul"
          portalContainer={portalContainer}
          className="flex h-[min(72dvh,calc(100dvh-5rem))] max-h-[min(72dvh,calc(100dvh-5rem))] flex-col overflow-hidden px-2"
          onPointerDownOutside={(e) => {
            const t = e.target as HTMLElement | null
            if (t?.closest?.('[data-vaul-overlay]')) return
            e.preventDefault()
          }}
        >
          <DrawerHeader className="sr-only">
            <DrawerTitle>Emoji Picker</DrawerTitle>
          </DrawerHeader>
          <div className="flex min-h-0 w-full max-w-[100vw] flex-1 flex-col overflow-hidden">
            {pickerMounted ? (
              <EmojiPicker
                layout="drawer"
                onEmojiClick={(emoji, e) => {
                  e.stopPropagation()
                  setOpen(false)
                  onEmojiClick?.(emoji)
                }}
              />
            ) : null}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        className="p-0 w-[min(100vw-1rem,350px)] max-w-[calc(100vw-1rem)] overflow-hidden flex flex-col"
        portalContainer={portalContainer}
      >
        <EmojiPicker
          onEmojiClick={(emoji, e) => {
            e.stopPropagation()
            setOpen(false)
            onEmojiClick?.(emoji)
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
