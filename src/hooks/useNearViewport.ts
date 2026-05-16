import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'

/** Pixels beyond the viewport edge to treat as visible (prefetch before scroll lands). */
export const NEAR_VIEWPORT_MARGIN_PX = 320

export function elementIsNearViewport(el: HTMLElement, marginPx: number): boolean {
  const rect = el.getBoundingClientRect()
  const vh = window.innerHeight
  const vw = window.innerWidth
  return (
    rect.bottom >= -marginPx &&
    rect.top <= vh + marginPx &&
    rect.right >= -marginPx &&
    rect.left <= vw + marginPx
  )
}

/**
 * True when `ref` points at an element intersecting the viewport (with margin).
 * When `enabled` is false, returns true immediately (no deferral).
 */
export function useNearViewport(
  ref: RefObject<HTMLElement | null>,
  options?: { enabled?: boolean; marginPx?: number }
): boolean {
  const enabled = options?.enabled !== false
  const marginPx = options?.marginPx ?? NEAR_VIEWPORT_MARGIN_PX
  const [isNear, setIsNear] = useState(() => !enabled)

  useLayoutEffect(() => {
    if (!enabled) {
      setIsNear(true)
      return
    }
    const el = ref.current
    if (!el) {
      setIsNear(false)
      return
    }
    if (elementIsNearViewport(el, marginPx)) {
      setIsNear(true)
      return
    }
    setIsNear(false)
  }, [enabled, marginPx, ref])

  useEffect(() => {
    if (!enabled || isNear) return
    if (typeof IntersectionObserver === 'undefined') {
      setIsNear(true)
      return
    }
    let io: IntersectionObserver | null = null
    let raf = 0
    const attach = () => {
      const el = ref.current
      if (!el || io) return
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setIsNear(true)
          }
        },
        { root: null, rootMargin: `${marginPx}px`, threshold: 0.01 }
      )
      io.observe(el)
    }
    raf = requestAnimationFrame(attach)
    return () => {
      cancelAnimationFrame(raf)
      io?.disconnect()
    }
  }, [enabled, isNear, marginPx, ref])

  return isNear
}
