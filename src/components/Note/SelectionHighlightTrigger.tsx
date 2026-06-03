import { buildHighlightDataFromEvent } from '@/lib/build-highlight-data'
import { useCreateHighlight } from './CreateHighlightContext'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { Event } from 'nostr-tools'
import { Highlighter } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

/** After finger lift, wait before treating the gesture as finished (handle drag may still run). */
const MOBILE_TOUCH_END_SETTLE_MS = 600
/** After selection stops changing, wait before opening the drawer so handles can extend the range. */
const MOBILE_SELECTION_STABLE_MS = 1600
const DESKTOP_SELECTION_DELAY_MS = 50

function getParagraphContextFromRange(range: Range): string {
  let node: Node | null = range.commonAncestorContainer
  if (node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement
  let el = node as Element | null
  while (el) {
    const tag = el.tagName?.toLowerCase()
    if (tag === 'p' || (tag?.startsWith('h') && /^h[1-6]$/.test(tag))) {
      return el.textContent?.trim() || range.toString().trim()
    }
    el = el.parentElement
  }
  return range.toString().trim()
}

function isRangeInContainer(range: Range, container: HTMLElement): boolean {
  const commonAncestor = range.commonAncestorContainer
  if (commonAncestor.nodeType === Node.ELEMENT_NODE) {
    if (container.contains(commonAncestor as Element)) return true
  } else {
    const parent = commonAncestor.parentElement
    if (parent && container.contains(parent)) return true
  }
  try {
    const contentRect = container.getBoundingClientRect()
    const rangeRect = range.getBoundingClientRect()
    return !(
      rangeRect.bottom < contentRect.top ||
      rangeRect.top > contentRect.bottom ||
      rangeRect.right < contentRect.left ||
      rangeRect.left > contentRect.right
    )
  } catch {
    return false
  }
}

function readSelectionInContainer(container: HTMLElement): {
  selectedText: string
  paragraphContext: string
  rect: DOMRect
} | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  if (!isRangeInContainer(range, container)) return null
  const selectedText = selection.toString().trim()
  if (!selectedText) return null
  return {
    selectedText,
    paragraphContext: getParagraphContextFromRange(range),
    rect: range.getBoundingClientRect()
  }
}

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

  const clearUi = useCallback(() => {
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
        clearUi()
        return
      }

      setSelectedText(hit.selectedText)
      setParagraphContext(hit.paragraphContext)

      if (isSmallScreen) {
        if (forceShow || !isSelectingRef.current) {
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

  useEffect(() => {
    if (!openHighlight) return

    const onMouseUp = (e: MouseEvent) => {
      if (isSmallScreen) return
      const el =
        e.target instanceof Element ? e.target : e.target instanceof Node ? e.target.parentElement : null
      if (el?.closest('[data-selection-highlight-ui]')) return
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
    const highlightData = buildHighlightDataFromEvent(event, paragraphContext)
    openHighlight(highlightData, selectedText)
    clearUi()
    window.getSelection()?.removeAllRanges()
  }, [clearUi, event, openHighlight, paragraphContext, selectedText])

  const handleDismiss = useCallback(() => {
    clearUi()
    window.getSelection()?.removeAllRanges()
  }, [clearUi])

  if (!openHighlight) return <>{children}</>

  const showDesktopToolbar = !isSmallScreen && selectedText && toolbarPos

  return (
    <div ref={containerRef} className="relative select-text">
      {children}
      {showDesktopToolbar ? (
        <>
          <div
            className="highlight-button-container fixed z-[150] flex items-center gap-1 rounded-md border bg-background px-2 py-1.5 shadow-lg"
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
            className="fixed inset-0 z-[149]"
            aria-hidden
            data-selection-highlight-ui
            onClick={handleDismiss}
          />
        </>
      ) : null}

      {isSmallScreen ? (
        <Drawer
          open={showMobileDrawer && selectedText.length > 0}
          onOpenChange={(open) => {
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
