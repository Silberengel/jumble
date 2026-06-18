import { useEffect, useState } from 'react'

export type VisualViewportInset = {
  /** Visible viewport height in CSS px. */
  height: number
  /** Gap between layout viewport bottom and visible viewport bottom (keyboard inset). */
  bottomInset: number
  /** Visible viewport offset from layout viewport top. */
  offsetTop: number
}

function readVisualViewportInset(): VisualViewportInset {
  if (typeof window === 'undefined') {
    return { height: 0, bottomInset: 0, offsetTop: 0 }
  }
  const vv = window.visualViewport
  if (!vv) {
    return {
      height: window.innerHeight,
      bottomInset: 0,
      offsetTop: 0
    }
  }
  const height = Math.round(vv.height)
  const offsetTop = Math.round(vv.offsetTop)
  const bottomInset = Math.max(0, Math.round(window.innerHeight - (vv.offsetTop + vv.height)))
  return { height, bottomInset, offsetTop }
}

/**
 * Tracks {@link VisualViewport} for composer footers on mobile — keeps actions above the keyboard
 * instead of locking sheet height at open time.
 */
export function useVisualViewportInset(): VisualViewportInset {
  const [inset, setInset] = useState(readVisualViewportInset)

  useEffect(() => {
    const sync = () => setInset(readVisualViewportInset())
    sync()
    window.addEventListener('resize', sync)
    window.addEventListener('orientationchange', sync)
    window.visualViewport?.addEventListener('resize', sync)
    window.visualViewport?.addEventListener('scroll', sync)
    return () => {
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', sync)
      window.visualViewport?.removeEventListener('resize', sync)
      window.visualViewport?.removeEventListener('scroll', sync)
    }
  }, [])

  return inset
}
