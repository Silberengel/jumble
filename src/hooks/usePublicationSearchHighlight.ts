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

    let applied = false
    let stopTimer: number | undefined

    /**
     * Apply (or re-apply) the highlight. Returns true when a mark is present afterwards. Cheap when a
     * mark already exists (querySelector only): the mark can be wiped by AsciiDoc post-processing
     * (embedded notes mounted via createRoot, progressive content, media extraction re-setting innerHTML),
     * so this stays callable for the whole retry window and re-inserts the mark if it disappears.
     */
    const tryHighlight = (): boolean => {
      if (cancelled) return true

      const root = containerRef.current
      if (!root) return false

      const existingMark = root.querySelector(
        `mark.${LIBRARY_SEARCH_TEXT_HIGHLIGHT_CLASS}`
      ) as HTMLElement | null
      if (existingMark) {
        markEl = existingMark
        applied = true
        if (!hasAnchoredScroll) {
          scrollHighlightIntoView(existingMark, 'instant')
          hasAnchoredScroll = true
          watchLayoutStability()
          window.setTimeout(notifyAnchored, 400)
        }
        return true
      }

      if (Date.now() - startedAt > HIGHLIGHT_RETRY_MS) return applied

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

      clearHighlightsInElement(root)
      markEl = highlightTextInElement(root, needle)
      if (!markEl) return false
      applied = true

      if (!hasAnchoredScroll) {
        scrollHighlightIntoView(markEl, 'instant')
        hasAnchoredScroll = true
        watchLayoutStability()
        window.setTimeout(notifyAnchored, 400)
      }

      return true
    }

    const stopWatching = () => {
      contentObserver?.disconnect()
      contentObserver = null
      window.clearTimeout(pollTimer)
    }

    // Until first success: poll fast for the content to arrive. After that the MutationObserver
    // re-applies on wipes, so a fast poll is no longer needed.
    const schedulePoll = () => {
      if (cancelled || applied) return
      tryHighlight()
      if (cancelled || applied) return
      pollTimer = window.setTimeout(schedulePoll, HIGHLIGHT_POLL_MS)
    }

    const root = containerRef.current
    if (root && typeof MutationObserver !== 'undefined') {
      // Keep observing for the whole retry window: re-inserts the mark whenever async rendering wipes it.
      contentObserver = new MutationObserver(() => {
        tryHighlight()
      })
      contentObserver.observe(root, {
        childList: true,
        subtree: true,
        characterData: true
      })
    }

    stopTimer = window.setTimeout(stopWatching, HIGHLIGHT_RETRY_MS)

    tryHighlight()
    schedulePoll()

    return () => {
      cancelled = true
      contentObserver?.disconnect()
      layoutObserver?.disconnect()
      window.clearTimeout(layoutWatchTimer)
      window.clearTimeout(rescrollTimer)
      window.clearTimeout(pollTimer)
      window.clearTimeout(stopTimer)
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
