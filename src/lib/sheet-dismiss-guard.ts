/**
 * Radix Sheet closes on outside pointer/focus. Full-page portals on `document.body`
 * (lightbox, Bitcoin Connect `bc-modal`) sit outside the Sheet DOM, so Radix treats
 * interactions there as "dismiss sheet" unless we call {@link preventDefault}.
 */

type RadixOutsideEvent = {
  preventDefault: () => void
  detail?: { originalEvent?: Event }
}

function eventComposedPath(e: RadixOutsideEvent): EventTarget[] {
  const orig = e.detail?.originalEvent
  if (orig && typeof orig.composedPath === 'function') {
    return orig.composedPath()
  }
  return []
}

function pathIncludesPortaledOverlay(path: EventTarget[]): boolean {
  return path.some((node) => {
    if (!(node instanceof HTMLElement)) return false
    if (node.tagName.toLowerCase() === 'bc-modal') return true
    if (node.hasAttribute('data-radix-dialog-content')) return true
    if (node.hasAttribute('data-radix-dialog-overlay')) return true
    if (node.getAttribute('role') === 'dialog' && node.closest('[data-radix-portal]')) return true
    return false
  })
}

export function preventRadixSheetCloseForPortaledOverlay(e: RadixOutsideEvent): void {
  if (typeof document === 'undefined') return
  if (document.body.classList.contains('yarl__no_scroll')) {
    e.preventDefault()
    return
  }
  const path = eventComposedPath(e)
  if (pathIncludesPortaledOverlay(path)) {
    e.preventDefault()
    return
  }
  if (document.querySelector('[data-radix-dialog-content][data-state="open"]')) {
    e.preventDefault()
  }
}
