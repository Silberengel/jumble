import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { DialogContext } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { preloadEmojiPicker } from '@/lib/emoji-picker-preload'
import { cn } from '@/lib/utils'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { TEmoji } from '@/types'
import { Slot } from '@radix-ui/react-slot'
import { useCallback, useContext, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const inDialog = useContext(DialogContext)
  /** Composer / nested modal: use centered shell (dropdown layout collapses the emoji grid). */
  const useDialogShell = Boolean(portalContainer || inDialog) && !isSmallScreen
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

  const pickerPanel =
    pickerMounted ? (
      <EmojiPicker
        layout={useDialogShell ? 'drawer' : 'popover'}
        onEmojiClick={(emoji, e) => {
          e.stopPropagation()
          setOpen(false)
          onEmojiClick?.(emoji)
        }}
      />
    ) : null

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
            {pickerPanel}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  if (useDialogShell) {
    const portalTarget = portalContainer ?? (typeof document !== 'undefined' ? document.body : null)
    const overlayPositionClass = portalContainer ? 'absolute inset-0' : 'fixed inset-0'
    return (
      <>
        <Slot
          onClick={(event: React.MouseEvent) => {
            event.stopPropagation()
            handleOpenChange(true)
          }}
        >
          {children}
        </Slot>
        {open && portalTarget
          ? createPortal(
              <div
                data-emoji-picker-shell
                className={cn(
                  'pointer-events-none z-[290] flex items-end justify-center p-3 pb-4 sm:items-center sm:p-4',
                  overlayPositionClass
                )}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={t('Close')}
                  className="pointer-events-auto absolute inset-0 z-0 cursor-default border-0 bg-black/20 p-0"
                  onClick={() => handleOpenChange(false)}
                />
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label={t('Insert emoji')}
                  className="pointer-events-auto relative z-10 flex h-[min(380px,55dvh)] w-[min(350px,calc(100vw-2rem))] max-w-[350px] flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg outline-none"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{pickerPanel}</div>
                </div>
              </div>,
              portalTarget
            )
          : null}
      </>
    )
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        disableScrollShell
        collisionPadding={12}
        className="pointer-events-auto !max-h-none h-auto w-[min(100%,350px)] max-w-[350px] flex flex-col p-0"
        portalContainer={portalContainer}
      >
        {pickerPanel}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
