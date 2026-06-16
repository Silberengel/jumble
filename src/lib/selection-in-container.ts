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

/** True when any portion of the range lies inside or overlaps `container`. */
export function isRangeInContainer(range: Range, container: HTMLElement): boolean {
  if (nodeInContainer(range.startContainer, container) && nodeInContainer(range.endContainer, container)) {
    return true
  }

  const commonAncestor = range.commonAncestorContainer
  if (nodeInContainer(commonAncestor, container)) return true

  try {
    const contentRect = container.getBoundingClientRect()
    const rangeRects = range.getClientRects()
    for (let i = 0; i < rangeRects.length; i++) {
      const rect = rangeRects[i]
      if (rect.width === 0 && rect.height === 0) continue
      if (rectsOverlap(rect, contentRect)) return true
    }

    const rangeRect = range.getBoundingClientRect()
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
  const selectedText = selection.toString().trim()
  if (!selectedText) return null
  const rects = range.getClientRects()
  let rect = range.getBoundingClientRect()
  if ((rect.width === 0 && rect.height === 0) && rects.length > 0) {
    rect = rects[0]
  }
  return {
    selectedText,
    paragraphContext: getParagraphContextFromRange(range),
    rect
  }
}

export function getParagraphContextFromRange(range: Range): string {
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

export function selectionIntersectsContainer(container: HTMLElement): boolean {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false
  return isRangeInContainer(selection.getRangeAt(0), container)
}
