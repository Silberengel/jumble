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

export function preventRadixSheetCloseForPortaledOverlay(e: RadixOutsideEvent): void {
  if (typeof document === 'undefined') return
  if (document.body.classList.contains('yarl__no_scroll')) {
    e.preventDefault()
    return
  }
  const path = eventComposedPath(e)
  const inBitcoinConnectModal = path.some(
    (node) => node instanceof HTMLElement && node.tagName.toLowerCase() === 'bc-modal'
  )
  if (inBitcoinConnectModal) {
    e.preventDefault()
  }
}
