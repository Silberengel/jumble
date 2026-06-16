import { buildHighlightDataFromEvent } from '@/lib/build-highlight-data'
import {
  readSelectionInContainer,
  readSelectionInContainerWithRetry
} from '@/lib/selection-in-container'
import type { OpenHighlightFn } from './CreateHighlightContext'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { Event } from 'nostr-tools'
import { Highlighter } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

/** After finger lift, wait before treating the gesture as finished (handle drag may still run). */
const MOBILE_TOUCH_END_SETTLE_MS = 600
/** After selection stops changing, wait before opening the drawer so handles can extend the range. */
const MOBILE_SELECTION_STABLE_MS = 1600

export default function SelectionHighlightTrigger({
  event,
  openHighlight,
  children
}: {
  event: Event
  openHighlight: OpenHighlightFn
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const containerRef = useRef<HTMLDivElement | null>(null) as MutableRefObject<HTMLDivElement | null>
  const mouseUpCleanupRef = useRef<(() => void) | null>(null)
  const retryCancelRef = useRef<(() => void) | null>(null)
  const toolbarVisibleRef = useRef(false)
  const [selectedText, setSelectedText] = useState('')
  const [paragraphContext, setParagraphContext] = useState('')
  const [toolbarPos, setToolbarPos] = useState<{ top: number; left: number } | null>(null)
  const [showMobileDrawer, setShowMobileDrawer] = useState(false)

  const touchEndTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectionStableTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isSelectingRef = useRef(false)
  const lastSelectionChangeRef = useRef(0)
  /** Skip drawer dismiss cleanup while opening the highlight composer. */
  const openingHighlightRef = useRef(false)

  const clearUi = useCallback(() => {
    toolbarVisibleRef.current = false
    setSelectedText('')
    setParagraphContext('')
    setToolbarPos(null)
    setShowMobileDrawer(false)
  }, [])

  const showDesktopHit = useCallback(
    (hit: { selectedText: string; paragraphContext: string; rect: DOMRect }) => {
      const toolbarHeight = 44
      const margin = 8
      const top =
        hit.rect.top - toolbarHeight < margin ? hit.rect.bottom + margin : hit.rect.top - toolbarHeight
      const rawLeft = hit.rect.left + hit.rect.width / 2 - 80
      const left = Math.max(margin, Math.min(rawLeft, window.innerWidth - 176 - margin))
      toolbarVisibleRef.current = true
      setSelectedText(hit.selectedText)
      setParagraphContext(hit.paragraphContext)
      setToolbarPos({ top, left })
      setShowMobileDrawer(false)
    },
    []
  )

  const tryShowDesktopSelection = useCallback(() => {
    const container = containerRef.current
    if (!container || isSmallScreen) return

    retryCancelRef.current?.()
    retryCancelRef.current = readSelectionInContainerWithRetry(
      container,
      showDesktopHit,
      () => {
        if (toolbarVisibleRef.current) clearUi()
      }
    )
  }, [clearUi, isSmallScreen, showDesktopHit])

  const applyMobileSelection = useCallback(
    (forceShow = false) => {
      if (!containerRef.current) return
      const hit = readSelectionInContainer(containerRef.current)
      if (!hit) {
        clearUi()
        return
      }
      setSelectedText(hit.selectedText)
      setParagraphContext(hit.paragraphContext)
      if (forceShow || !isSelectingRef.current) {
        setShowMobileDrawer(true)
        setToolbarPos(null)
      }
    },
    [clearUi]
  )

  const scheduleMobileStableSelection = useCallback(() => {
    lastSelectionChangeRef.current = Date.now()
    if (selectionStableTimeoutRef.current) clearTimeout(selectionStableTimeoutRef.current)
    selectionStableTimeoutRef.current = setTimeout(() => {
      const elapsed = Date.now() - lastSelectionChangeRef.current
      if (elapsed >= MOBILE_SELECTION_STABLE_MS && !isSelectingRef.current) {
        applyMobileSelection(true)
      }
    }, MOBILE_SELECTION_STABLE_MS)
  }, [applyMobileSelection])

  const attachContainer = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node
      mouseUpCleanupRef.current?.()
      mouseUpCleanupRef.current = null

      if (!node || isSmallScreen) return

      const onMouseUp = (e: MouseEvent) => {
        const target = e.target
        if (target instanceof Element && target.closest('[data-selection-highlight-ui]')) return
        tryShowDesktopSelection()
      }

      node.addEventListener('mouseup', onMouseUp)
      mouseUpCleanupRef.current = () => node.removeEventListener('mouseup', onMouseUp)
    },
    [isSmallScreen, tryShowDesktopSelection]
  )

  useEffect(() => {
    if (isSmallScreen || !toolbarVisibleRef.current) return

    const onDocumentMouseDown = (e: MouseEvent) => {
      const target = e.target
      if (!(target instanceof Node)) return
      if (target instanceof Element && target.closest('[data-selection-highlight-ui]')) return
      if (containerRef.current?.contains(target)) return
      clearUi()
      window.getSelection()?.removeAllRanges()
    }

    document.addEventListener('mousedown', onDocumentMouseDown)
    return () => document.removeEventListener('mousedown', onDocumentMouseDown)
  }, [clearUi, isSmallScreen, selectedText, toolbarPos])

  useEffect(() => {
    if (!isSmallScreen) return

    const onTouchStart = () => {
      isSelectingRef.current = true
      if (selectionStableTimeoutRef.current) clearTimeout(selectionStableTimeoutRef.current)
      setShowMobileDrawer(false)
    }

    const onTouchMove = () => {
      isSelectingRef.current = true
      if (selectionStableTimeoutRef.current) clearTimeout(selectionStableTimeoutRef.current)
      setShowMobileDrawer(false)
    }

    const onTouchEnd = () => {
      if (touchEndTimeoutRef.current) clearTimeout(touchEndTimeoutRef.current)
      touchEndTimeoutRef.current = setTimeout(() => {
        isSelectingRef.current = false
        scheduleMobileStableSelection()
      }, MOBILE_TOUCH_END_SETTLE_MS)
    }

    const onSelectionChange = () => {
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
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: true })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    document.addEventListener('selectionchange', onSelectionChange)

    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('selectionchange', onSelectionChange)
      if (touchEndTimeoutRef.current) clearTimeout(touchEndTimeoutRef.current)
      if (selectionStableTimeoutRef.current) clearTimeout(selectionStableTimeoutRef.current)
    }
  }, [clearUi, isSmallScreen, scheduleMobileStableSelection])

  useEffect(
    () => () => {
      retryCancelRef.current?.()
      mouseUpCleanupRef.current?.()
    },
    []
  )

  const handleCreateHighlight = useCallback(() => {
    if (!selectedText) return
    openingHighlightRef.current = true
    const highlightData = buildHighlightDataFromEvent(event, paragraphContext)
    openHighlight(highlightData, selectedText)
    window.getSelection()?.removeAllRanges()
    clearUi()
    window.setTimeout(() => {
      openingHighlightRef.current = false
    }, 400)
  }, [clearUi, event, openHighlight, paragraphContext, selectedText])

  const handleDismiss = useCallback(() => {
    if (openingHighlightRef.current) return
    clearUi()
    window.getSelection()?.removeAllRanges()
  }, [clearUi])

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
                onMouseDown={(e) => e.preventDefault()}
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
                onMouseDown={(e) => e.preventDefault()}
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
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleDismiss}
            />
          </>,
          document.body
        )
      : null

  return (
    <div
      ref={attachContainer}
      className="relative select-text"
      data-highlight-container
      onContextMenu={() => {
        if (!isSmallScreen) tryShowDesktopSelection()
      }}
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
