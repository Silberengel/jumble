/** Sync `--vh` to the visible viewport (px). Used for mobile min-height and legacy call sites. */
export function syncViewportHeightCssVar(): void {
  const h = window.visualViewport?.height ?? window.innerHeight
  document.documentElement.style.setProperty('--vh', `${h}px`)
}

/** Keep `--vh` aligned when the window, visual viewport, or root layout (e.g. font scaling) changes. */
export function installViewportHeightListeners(): () => void {
  const sync = () => syncViewportHeightCssVar()

  window.addEventListener('resize', sync)
  window.addEventListener('orientationchange', sync)
  window.visualViewport?.addEventListener('resize', sync)

  let ro: ResizeObserver | undefined
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(sync)
    ro.observe(document.documentElement)
  }

  sync()

  return () => {
    window.removeEventListener('resize', sync)
    window.removeEventListener('orientationchange', sync)
    window.visualViewport?.removeEventListener('resize', sync)
    ro?.disconnect()
  }
}
