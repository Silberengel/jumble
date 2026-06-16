function nodeInContainer(node: Node, container: HTMLElement): boolean {
  if (node === container) return true
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  return Boolean(el && container.contains(el))
}

function rectsOverlap(a: DOMRect, b: DOMRect): boolean {
  return !(
    a.bottom < b.top ||
    a.top > b.bottom ||
    a.right < b.left ||
    a.left > b.right
  )
}

function rangeDisplayRect(range: Range): DOMRect {
  try {
    if (typeof range.getBoundingClientRect === 'function') {
      const rect = range.getBoundingClientRect()
      if (rect.width > 0 || rect.height > 0) return rect
    }
    if (typeof range.getClientRects === 'function') {
      const rects = range.getClientRects()
      for (let i = 0; i < rects.length; i++) {
        const rect = rects[i]
        if (rect.width > 0 || rect.height > 0) return rect
      }
    }
  } catch {
    /* layout APIs unavailable */
  }
  return new DOMRect(8, 8, 1, 1)
}

function selectionText(selection: Selection, range: Range): string {
  return (selection.toString() || range.toString()).trim()
}

/** True when any portion of the range lies inside or overlaps `container`. */
export function isRangeInContainer(range: Range, container: HTMLElement): boolean {
  if (nodeInContainer(range.startContainer, container) && nodeInContainer(range.endContainer, container)) {
    return true
  }

  const commonAncestor = range.commonAncestorContainer
  if (nodeInContainer(commonAncestor, container)) return true

  try {
    const contentRect = container.getBoundingClientRect()
    const rangeRects =
      typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : []
    for (let i = 0; i < rangeRects.length; i++) {
      const rect = rangeRects[i]
      if (rect.width === 0 && rect.height === 0) continue
      if (rectsOverlap(rect, contentRect)) return true
    }

    const rangeRect = rangeDisplayRect(range)
    if (rangeRect.width > 0 || rangeRect.height > 0) {
      return rectsOverlap(rangeRect, contentRect)
    }
  } catch {
    return false
  }

  return false
}

export function readSelectionInContainer(container: HTMLElement): {
  selectedText: string
  paragraphContext: string
  rect: DOMRect
} | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  if (!isRangeInContainer(range, container)) return null
  const selectedText = selectionText(selection, range)
  if (!selectedText) return null
  return {
    selectedText,
    paragraphContext: getParagraphContextFromRange(range),
    rect: rangeDisplayRect(range)
  }
}

export function getParagraphContextFromRange(range: Range): string {
  let node: Node | null = range.commonAncestorContainer
  if (node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement
  let el = node as Element | null
  while (el) {
    const tag = el.tagName?.toLowerCase()
    if (tag === 'p' || tag === 'div' || tag === 'li' || (tag?.startsWith('h') && /^h[1-6]$/.test(tag))) {
      const text = el.textContent?.trim()
      if (text) return text
    }
    el = el.parentElement
  }
  return range.toString().trim()
}

export function selectionIntersectsContainer(container: HTMLElement): boolean {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false
  return isRangeInContainer(selection.getRangeAt(0), container)
}

/** Read selection after mouseup; browsers often commit the range one frame late. */
export function readSelectionInContainerWithRetry(
  container: HTMLElement,
  onHit: (hit: NonNullable<ReturnType<typeof readSelectionInContainer>>) => void,
  onMiss?: () => void
): () => void {
  let cancelled = false
  const delays = [0, 0, 50, 100, 200]

  const attempt = (index: number) => {
    if (cancelled) return
    const hit = readSelectionInContainer(container)
    if (hit) {
      onHit(hit)
      return
    }
    if (index + 1 >= delays.length) {
      onMiss?.()
      return
    }
    window.setTimeout(() => attempt(index + 1), delays[index + 1])
  }

  requestAnimationFrame(() => requestAnimationFrame(() => attempt(0)))

  return () => {
    cancelled = true
  }
}
