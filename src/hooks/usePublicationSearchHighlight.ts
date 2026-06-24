import { findSearchHighlightNeedle } from '@/lib/general-search-text-match'
import {
  clearHighlightsInElement,
  highlightTextInElement,
  LIBRARY_SEARCH_TEXT_HIGHLIGHT_CLASS
} from '@/lib/highlight-text-in-element'
import { useEffect, useRef, type RefObject } from 'react'

const LAYOUT_WATCH_MS = 8_000
const REScroll_DEBOUNCE_MS = 100
/** AsciiDoc sections load lazily and parse async; keep trying long enough for large books. */
const HIGHLIGHT_RETRY_MS = 45_000
const HIGHLIGHT_POLL_MS = 120

function scrollHighlightIntoView(mark: HTMLElement, behavior: ScrollBehavior = 'instant'): void {
  mark.scrollIntoView({ behavior, block: 'center', inline: 'nearest' })
}

export function usePublicationSearchHighlight(
  containerRef: RefObject<HTMLElement | null>,
  query: string,
  active: boolean,
  options?: { onAnchored?: () => void; sourceText?: string }
): void {
  const onAnchoredRef = useRef(options?.onAnchored)
  onAnchoredRef.current = options?.onAnchored
  const sourceTextRef = useRef(options?.sourceText)
  sourceTextRef.current = options?.sourceText
  const anchoredRef = useRef(false)

  useEffect(() => {
    anchoredRef.current = false
  }, [query, active])

  useEffect(() => {
    if (!active || !query.trim()) return

    let cancelled = false
    const startedAt = Date.now()
    let layoutObserver: ResizeObserver | null = null
    let layoutWatchTimer: number | undefined
    let rescrollTimer: number | undefined
    let pollTimer: number | undefined
    let markEl: HTMLElement | null = null
    let contentObserver: MutationObserver | null = null
    let hasAnchoredScroll = false

    const notifyAnchored = () => {
      if (anchoredRef.current) return
      anchoredRef.current = true
      onAnchoredRef.current?.()
    }

    const scrollExistingMark = (behavior: ScrollBehavior) => {
      const root = containerRef.current
      if (!root) return
      const mark = root.querySelector(`mark.${LIBRARY_SEARCH_TEXT_HIGHLIGHT_CLASS}`) as HTMLElement | null
      if (mark) scrollHighlightIntoView(mark, behavior)
    }

    const scheduleRescroll = () => {
      if (cancelled) return
      window.clearTimeout(rescrollTimer)
      rescrollTimer = window.setTimeout(() => {
        scrollExistingMark('instant')
      }, REScroll_DEBOUNCE_MS)
    }

    const watchLayoutStability = () => {
      const root = containerRef.current
      if (!root || typeof ResizeObserver === 'undefined') return

      layoutObserver?.disconnect()
      layoutObserver = new ResizeObserver(() => {
        scheduleRescroll()
      })
      layoutObserver.observe(root)

      const scrollParent = findScrollParent(root)
      if (scrollParent && scrollParent !== root) {
        layoutObserver.observe(scrollParent)
      }

      layoutWatchTimer = window.setTimeout(() => {
        layoutObserver?.disconnect()
        layoutObserver = null
      }, LAYOUT_WATCH_MS)
    }

    const tryHighlight = (): boolean => {
      if (cancelled) return true
      if (Date.now() - startedAt > HIGHLIGHT_RETRY_MS) return true

      const root = containerRef.current
      if (!root) return false

      const domHaystack = root.textContent ?? ''
      let needle = findSearchHighlightNeedle(domHaystack, query)
      if (!needle) {
        const sourceHaystack = sourceTextRef.current
        if (sourceHaystack) {
          const fromSource = findSearchHighlightNeedle(sourceHaystack, query)
          if (fromSource && domHaystack.toLowerCase().includes(fromSource.toLowerCase())) {
            needle = fromSource
          }
        }
      }
      if (!needle) return false

      const existingMark = root.querySelector(
        `mark.${LIBRARY_SEARCH_TEXT_HIGHLIGHT_CLASS}`
      ) as HTMLElement | null
      if (existingMark) {
        markEl = existingMark
        if (!hasAnchoredScroll) {
          scrollHighlightIntoView(existingMark, 'instant')
          hasAnchoredScroll = true
          watchLayoutStability()
          window.setTimeout(notifyAnchored, 400)
        }
        return true
      }

      clearHighlightsInElement(root)
      markEl = highlightTextInElement(root, needle)
      if (!markEl) return false

      if (!hasAnchoredScroll) {
        scrollHighlightIntoView(markEl, 'instant')
        hasAnchoredScroll = true
        watchLayoutStability()
        window.setTimeout(notifyAnchored, 400)
      }

      return true
    }

    const schedulePoll = () => {
      if (cancelled || tryHighlight()) return
      pollTimer = window.setTimeout(schedulePoll, HIGHLIGHT_POLL_MS)
    }

    const root = containerRef.current
    if (root && typeof MutationObserver !== 'undefined') {
      contentObserver = new MutationObserver(() => {
        if (tryHighlight()) {
          contentObserver?.disconnect()
          contentObserver = null
        }
      })
      contentObserver.observe(root, {
        childList: true,
        subtree: true,
        characterData: true
      })
    }

    tryHighlight()
    schedulePoll()

    return () => {
      cancelled = true
      contentObserver?.disconnect()
      layoutObserver?.disconnect()
      window.clearTimeout(layoutWatchTimer)
      window.clearTimeout(rescrollTimer)
      window.clearTimeout(pollTimer)
      clearHighlightsInElement(containerRef.current)
      markEl = null
    }
  }, [containerRef, query, active])
}

function findScrollParent(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement
  while (node) {
    const style = window.getComputedStyle(node)
    if (/(auto|scroll)/.test(style.overflowY)) return node
    node = node.parentElement
  }
  return null
}
