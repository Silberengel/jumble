import { useState, useEffect, useRef, useCallback } from 'react'
import { MOBILE_SWIPE_BACK_EDGE_PX, useMobileSwipeBackOnElement } from '@/lib/mobile-swipe-back'
import { preventRadixSheetCloseForPortaledOverlay } from '@/lib/sheet-dismiss-guard'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import NotePage from '@/pages/secondary/NotePage'
import { useSecondaryPage } from '@/PageManager'
import type { Event } from 'nostr-tools'

interface NoteDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  noteId: string | null
  initialEvent?: Event | null
}

export default function NoteDrawer({ open, onOpenChange, noteId, initialEvent }: NoteDrawerProps) {
  const { currentIndex, pop } = useSecondaryPage()
  const [displayNoteId, setDisplayNoteId] = useState<string | null>(noteId)
  const [swipeEdge, setSwipeEdge] = useState<HTMLElement | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const closingFromSwipeRef = useRef(false)

  const handleSwipeBack = useCallback(() => {
    if (!open || closingFromSwipeRef.current) return
    closingFromSwipeRef.current = true
    pop()
  }, [open, pop])

  useEffect(() => {
    if (open) closingFromSwipeRef.current = false
  }, [open, noteId])

  useMobileSwipeBackOnElement(open ? swipeEdge : null, handleSwipeBack, {
    enabled: open,
    edgePx: MOBILE_SWIPE_BACK_EDGE_PX
  })

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }

    if (noteId) {
      setDisplayNoteId(noteId)
    } else if (!open && displayNoteId) {
      timeoutRef.current = setTimeout(() => {
        setDisplayNoteId(null)
        timeoutRef.current = null
      }, 350)
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [noteId, open])

  if (!displayNoteId) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange} registerWithModalManager={false}>
      <SheetContent
        side="right"
        className="relative w-full overscroll-contain sm:max-w-[1042px] overflow-y-auto p-0"
        hideClose
        onPointerDownOutside={(e) => preventRadixSheetCloseForPortaledOverlay(e)}
        onInteractOutside={(e) => preventRadixSheetCloseForPortaledOverlay(e)}
      >
        <div
          ref={setSwipeEdge}
          className="absolute inset-y-0 left-0 z-20 touch-none"
          style={{ width: MOBILE_SWIPE_BACK_EDGE_PX }}
          aria-hidden
        />
        <div className="min-h-full touch-pan-y">
          <NotePage
            id={displayNoteId}
            index={currentIndex}
            hideTitlebar={false}
            initialEvent={initialEvent ?? undefined}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
