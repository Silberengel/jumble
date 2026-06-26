export const LIBRARY_SEARCH_TEXT_HIGHLIGHT_CLASS = 'library-search-text-highlight'

const HIGHLIGHT_CLASS = LIBRARY_SEARCH_TEXT_HIGHLIGHT_CLASS

function createHighlightMark(text: string): HTMLElement {
  const mark = document.createElement('mark')
  mark.className = HIGHLIGHT_CLASS
  mark.style.backgroundColor = 'rgb(254 240 138 / 0.9)'
  mark.style.borderRadius = '2px'
  mark.style.padding = '0 1px'
  mark.textContent = text
  return mark
}

/** Wrap [start, end) of a single text node in a highlight mark. Returns the created mark. */
function wrapTextNodeRange(node: Text, start: number, end: number): HTMLElement | null {
  const text = node.textContent ?? ''
  const parent = node.parentNode
  if (!parent || start >= end) return null

  const before = text.slice(0, start)
  const match = text.slice(start, end)
  const after = text.slice(end)
  const mark = createHighlightMark(match)

  const frag = document.createDocumentFragment()
  if (before) frag.appendChild(document.createTextNode(before))
  frag.appendChild(mark)
  if (after) frag.appendChild(document.createTextNode(after))
  parent.replaceChild(frag, node)
  return mark
}

/**
 * Highlight the first occurrence of {@code needle} under {@code root}. The match is case-insensitive and
 * may span multiple text nodes (e.g. a passage that crosses inline markup), so the full phrase is marked
 * rather than only the first run. Returns the first created mark (for scroll anchoring).
 */
export function highlightTextInElement(root: HTMLElement, needle: string): HTMLElement | null {
  const trimmed = needle.trim()
  if (!trimmed) return null

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const segments: { node: Text; start: number; end: number }[] = []
  let full = ''
  let node = walker.nextNode() as Text | null
  while (node) {
    const text = node.textContent ?? ''
    segments.push({ node, start: full.length, end: full.length + text.length })
    full += text
    node = walker.nextNode() as Text | null
  }
  if (segments.length === 0) return null

  const idx = full.toLowerCase().indexOf(trimmed.toLowerCase())
  if (idx === -1) return null
  const endIdx = idx + trimmed.length

  let firstMark: HTMLElement | null = null
  for (const segment of segments) {
    if (segment.end <= idx || segment.start >= endIdx) continue
    const nodeLength = (segment.node.textContent ?? '').length
    const localStart = Math.max(0, idx - segment.start)
    const localEnd = Math.min(nodeLength, endIdx - segment.start)
    const mark = wrapTextNodeRange(segment.node, localStart, localEnd)
    if (mark && !firstMark) firstMark = mark
  }

  return firstMark
}

export function clearHighlightsInElement(root: HTMLElement | null | undefined): void {
  if (!root) return
  for (const mark of root.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`)) {
    const parent = mark.parentNode
    if (!parent) continue
    parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark)
    parent.normalize()
  }
}
