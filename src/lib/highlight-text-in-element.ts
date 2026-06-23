export const LIBRARY_SEARCH_TEXT_HIGHLIGHT_CLASS = 'library-search-text-highlight'

const HIGHLIGHT_CLASS = LIBRARY_SEARCH_TEXT_HIGHLIGHT_CLASS

export function highlightTextInElement(root: HTMLElement, needle: string): HTMLElement | null {
  const trimmed = needle.trim()
  if (!trimmed) return null

  const needleLower = trimmed.toLowerCase()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode() as Text | null

  while (node) {
    const text = node.textContent ?? ''
    const idx = text.toLowerCase().indexOf(needleLower)
    if (idx !== -1) {
      const before = text.slice(0, idx)
      const match = text.slice(idx, idx + trimmed.length)
      const after = text.slice(idx + trimmed.length)
      const parent = node.parentNode
      if (!parent) return null

      const mark = document.createElement('mark')
      mark.className = HIGHLIGHT_CLASS
      mark.style.backgroundColor = 'rgb(254 240 138 / 0.9)'
      mark.style.borderRadius = '2px'
      mark.style.padding = '0 1px'
      mark.textContent = match

      const frag = document.createDocumentFragment()
      if (before) frag.appendChild(document.createTextNode(before))
      frag.appendChild(mark)
      if (after) frag.appendChild(document.createTextNode(after))
      parent.replaceChild(frag, node)
      return mark
    }
    node = walker.nextNode() as Text | null
  }

  return null
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
