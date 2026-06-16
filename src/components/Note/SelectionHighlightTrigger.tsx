import { buildHighlightDataFromEvent } from '@/lib/build-highlight-data'
import {
  readSelectionInContainer,
  selectionIntersectsContainer
} from '@/lib/selection-in-container'
import { useCreateHighlight } from './CreateHighlightContext'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { Event } from 'nostr-tools'
import { Highlighter } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

/** After finger lift, wait before treating the gesture as finished (handle drag may still run). */
const MOBILE_TOUCH_END_SETTLE_MS = 600
/** After selection stops changing, wait before opening the drawer so handles can extend the range. */
const MOBILE_SELECTION_STABLE_MS = 1600
const DESKTOP_SELECTION_DELAY_MS = 50

export default function SelectionHighlightTrigger({
  event,
  children
}: {
  event: Event
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const openHighlight = useCreateHighlight()
  const containerRef = useRef<HTMLDivElement>(null)
  const [selectedText, setSelectedText] = useState('')
  const [paragraphContext, setParagraphContext] = useState('')
  const [toolbarPos, setToolbarPos] = useState<{ top: number; left: number } | null>(null)
  const [showMobileDrawer, setShowMobileDrawer] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchEndTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectionStableTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isSelectingRef = useRef(false)
  const lastSelectionChangeRef = useRef(0)
  const activeToolbarRef = useRef(false)
  /** Skip drawer dismiss cleanup while opening the highlight composer. */
  const openingHighlightRef = useRef(false)

  const clearUi = useCallback(() => {
    activeToolbarRef.current = false
    setSelectedText('')
    setParagraphContext('')
    setToolbarPos(null)
    setShowMobileDrawer(false)
  }, [])

  const applySelection = useCallback(
    (forceShow = false) => {
      if (!openHighlight || !containerRef.current) return
      const hit = readSelectionInContainer(containerRef.current)
      if (!hit) {
        if (activeToolbarRef.current) clearUi()
        return
      }

      setSelectedText(hit.selectedText)
      setParagraphContext(hit.paragraphContext)

      if (isSmallScreen) {
        if (forceShow || !isSelectingRef.current) {
          activeToolbarRef.current = true
          setShowMobileDrawer(true)
          setToolbarPos(null)
        }
        return
      }

      const toolbarHeight = 44
      const margin = 8
      const top =
        hit.rect.top - toolbarHeight < margin ? hit.rect.bottom + margin : hit.rect.top - toolbarHeight
      const rawLeft = hit.rect.left + hit.rect.width / 2 - 80
      const left = Math.max(margin, Math.min(rawLeft, window.innerWidth - 176 - margin))
      activeToolbarRef.current = true
      setToolbarPos({ top, left })
      setShowMobileDrawer(false)
    },
    [clearUi, isSmallScreen, openHighlight]
  )

  const scheduleDesktopSelection = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => applySelection(true), DESKTOP_SELECTION_DELAY_MS)
  }, [applySelection])

  const scheduleMobileStableSelection = useCallback(() => {
    lastSelectionChangeRef.current = Date.now()
    if (selectionStableTimeoutRef.current) clearTimeout(selectionStableTimeoutRef.current)
    selectionStableTimeoutRef.current = setTimeout(() => {
      const elapsed = Date.now() - lastSelectionChangeRef.current
      if (elapsed >= MOBILE_SELECTION_STABLE_MS && !isSelectingRef.current) {
        applySelection(true)
      }
    }, MOBILE_SELECTION_STABLE_MS)
  }, [applySelection])

  const handlePointerUpInContainer = useCallback(() => {
    if (isSmallScreen || !containerRef.current) return
    if (!selectionIntersectsContainer(containerRef.current)) return
    scheduleDesktopSelection()
  }, [isSmallScreen, scheduleDesktopSelection])

  useEffect(() => {
    if (!openHighlight) return

    const onMouseUp = (e: MouseEvent) => {
      if (isSmallScreen || !containerRef.current) return
      const el =
        e.target instanceof Element ? e.target : e.target instanceof Node ? e.target.parentElement : null
      if (el?.closest('[data-selection-highlight-ui]')) return
      const targetInContainer = Boolean(el && containerRef.current.contains(el))
      if (!targetInContainer && !selectionIntersectsContainer(containerRef.current)) return
      scheduleDesktopSelection()
    }

    const onTouchStart = () => {
      if (!isSmallScreen) return
      isSelectingRef.current = true
      if (selectionStableTimeoutRef.current) clearTimeout(selectionStableTimeoutRef.current)
      setShowMobileDrawer(false)
    }

    const onTouchMove = () => {
      if (!isSmallScreen) return
      isSelectingRef.current = true
      if (selectionStableTimeoutRef.current) clearTimeout(selectionStableTimeoutRef.current)
      setShowMobileDrawer(false)
    }

    const onTouchEnd = () => {
      if (!isSmallScreen) return
      if (touchEndTimeoutRef.current) clearTimeout(touchEndTimeoutRef.current)
      touchEndTimeoutRef.current = setTimeout(() => {
        isSelectingRef.current = false
        scheduleMobileStableSelection()
      }, MOBILE_TOUCH_END_SETTLE_MS)
    }

    const onSelectionChange = () => {
      if (isSmallScreen) {
        lastSelectionChangeRef.current = Date.now()
        if (isSelectingRef.current) return

        const selection = window.getSelection()
        const hasSelection =
          selection &&
          !selection.isCollapsed &&
          selection.rangeCount > 0 &&
          selection.toString().trim().length > 0

        if (!hasSelection) {
          if (selectionStableTimeoutRef.current) clearTimeout(selectionStableTimeoutRef.current)
          clearUi()
          return
        }

        scheduleMobileStableSelection()
        return
      }

      if (!containerRef.current) return

      const selection = window.getSelection()
      const hasSelection =
        selection &&
        !selection.isCollapsed &&
        selection.rangeCount > 0 &&
        selection.toString().trim().length > 0

      if (!hasSelection) {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        if (activeToolbarRef.current) clearUi()
        return
      }

      if (!selectionIntersectsContainer(containerRef.current)) return

      scheduleDesktopSelection()
    }

    const onContextMenu = (e: MouseEvent) => {
      if (!containerRef.current) return
      const target = e.target
      if (!(target instanceof Node) || !containerRef.current.contains(target)) return
      queueMicrotask(() => applySelection(true))
    }

    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: true })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('contextmenu', onContextMenu)

    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('contextmenu', onContextMenu)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (touchEndTimeoutRef.current) clearTimeout(touchEndTimeoutRef.current)
      if (selectionStableTimeoutRef.current) clearTimeout(selectionStableTimeoutRef.current)
    }
  }, [
    applySelection,
    clearUi,
    isSmallScreen,
    openHighlight,
    scheduleDesktopSelection,
    scheduleMobileStableSelection
  ])

  const handleCreateHighlight = useCallback(() => {
    if (!selectedText || !openHighlight) return
    openingHighlightRef.current = true
    const highlightData = buildHighlightDataFromEvent(event, paragraphContext)
    const excerpt = selectedText
    openHighlight(highlightData, excerpt)
    window.getSelection()?.removeAllRanges()
    activeToolbarRef.current = false
    setSelectedText('')
    setParagraphContext('')
    setToolbarPos(null)
    setShowMobileDrawer(false)
    window.setTimeout(() => {
      openingHighlightRef.current = false
    }, 400)
  }, [event, openHighlight, paragraphContext, selectedText])

  const handleDismiss = useCallback(() => {
    if (openingHighlightRef.current) return
    clearUi()
    window.getSelection()?.removeAllRanges()
  }, [clearUi])

  if (!openHighlight) return <>{children}</>

  const showDesktopToolbar = !isSmallScreen && selectedText && toolbarPos

  const desktopToolbar =
    showDesktopToolbar && typeof document !== 'undefined'
      ? createPortal(
          <>
            <div
              className="highlight-button-container fixed z-[220] flex items-center gap-1 rounded-md border bg-background px-2 py-1.5 shadow-lg"
              data-selection-highlight-ui
              style={{ top: toolbarPos.top, left: toolbarPos.left }}
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5"
                onClick={(e) => {
                  e.stopPropagation()
                  handleCreateHighlight()
                }}
              >
                <Highlighter className="h-4 w-4" />
                {t('Create Highlight')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDismiss()
                }}
              >
                {t('Cancel')}
              </Button>
            </div>
            <div
              className="fixed inset-0 z-[219]"
              aria-hidden
              data-selection-highlight-ui
              onClick={handleDismiss}
            />
          </>,
          document.body
        )
      : null

  return (
    <div
      ref={containerRef}
      className="relative select-text"
      onPointerUp={handlePointerUpInContainer}
    >
      {children}
      {desktopToolbar}
      {isSmallScreen ? (
        <Drawer
          open={showMobileDrawer && selectedText.length > 0}
          onOpenChange={(open) => {
            if (!open && openingHighlightRef.current) {
              setShowMobileDrawer(false)
              return
            }
            setShowMobileDrawer(open)
            if (!open) handleDismiss()
          }}
        >
          <DrawerContent data-selection-highlight-ui>
            <DrawerHeader>
              <DrawerTitle>{t('Create Highlight')}</DrawerTitle>
            </DrawerHeader>
            <div className="space-y-4 p-4 pb-8">
              <div className="text-sm text-muted-foreground">{t('Selected text')}:</div>
              <div className="break-words rounded-lg bg-muted p-3 text-sm">&ldquo;{selectedText}&rdquo;</div>
              <Button
                className="w-full"
                onClick={(e) => {
                  e.stopPropagation()
                  handleCreateHighlight()
                }}
              >
                <Highlighter className="mr-2 h-4 w-4" />
                {t('Create Highlight')}
              </Button>
            </div>
          </DrawerContent>
        </Drawer>
      ) : null}
    </div>
  )
}
