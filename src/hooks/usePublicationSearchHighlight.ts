import { findSearchHighlightNeedle } from '@/lib/general-search-text-match'
import {
  clearHighlightsInElement,
  highlightTextInElement,
  LIBRARY_SEARCH_TEXT_HIGHLIGHT_CLASS
} from '@/lib/highlight-text-in-element'
import { useEffect, useRef, type RefObject } from 'react'

const LAYOUT_WATCH_MS = 5_000
const REScroll_DEBOUNCE_MS = 80

function scrollHighlightIntoView(mark: HTMLElement, behavior: ScrollBehavior = 'smooth'): void {
  mark.scrollIntoView({ behavior, block: 'center', inline: 'nearest' })
}

export function usePublicationSearchHighlight(
  containerRef: RefObject<HTMLElement | null>,
  query: string,
  active: boolean,
  options?: { onAnchored?: () => void }
): void {
  const onAnchoredRef = useRef(options?.onAnchored)
  onAnchoredRef.current = options?.onAnchored
  const anchoredRef = useRef(false)

  useEffect(() => {
    anchoredRef.current = false
  }, [query, active])

  useEffect(() => {
    if (!active || !query.trim()) return

    let cancelled = false
    let attempts = 0
    const maxAttempts = 60
    let layoutObserver: ResizeObserver | null = null
    let layoutWatchTimer: number | undefined
    let rescrollTimer: number | undefined
    let markEl: HTMLElement | null = null

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

      layoutWatchTimer = window.setTimeout(() => {
        layoutObserver?.disconnect()
        layoutObserver = null
      }, LAYOUT_WATCH_MS)
    }

    const tryHighlight = () => {
      if (cancelled) return
      const root = containerRef.current
      if (!root) {
        if (attempts++ < maxAttempts) requestAnimationFrame(tryHighlight)
        return
      }

      const needle = findSearchHighlightNeedle(root.textContent ?? '', query)
      if (!needle) {
        if (attempts++ < maxAttempts) requestAnimationFrame(tryHighlight)
        return
      }

      clearHighlightsInElement(root)
      markEl = highlightTextInElement(root, needle)
      if (!markEl) {
        if (attempts++ < maxAttempts) requestAnimationFrame(tryHighlight)
        return
      }

      scrollHighlightIntoView(markEl, 'smooth')
      notifyAnchored()
      watchLayoutStability()
    }

    tryHighlight()
    return () => {
      cancelled = true
      layoutObserver?.disconnect()
      window.clearTimeout(layoutWatchTimer)
      window.clearTimeout(rescrollTimer)
      clearHighlightsInElement(containerRef.current)
      markEl = null
    }
  }, [containerRef, query, active])
}
