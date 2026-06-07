import { elementIsNearVisibleScrollport, nearestScrollportRoot } from '@/lib/utils'
import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'

/** Pixels beyond the viewport edge to treat as visible (prefetch before scroll lands). */
export const NEAR_VIEWPORT_MARGIN_PX = 320

/** @deprecated Prefer {@link elementIsNearVisibleScrollport} — respects nested scrollports. */
export function elementIsNearViewport(el: HTMLElement, marginPx: number): boolean {
  return elementIsNearVisibleScrollport(el, marginPx)
}

/**
 * True when `ref` points at an element intersecting the viewport or nearest scrollport (with margin).
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
    if (elementIsNearVisibleScrollport(el, marginPx)) {
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
      const scrollRoot = nearestScrollportRoot(el)
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setIsNear(true)
          }
        },
        {
          root: scrollRoot ?? null,
          rootMargin: `${marginPx}px`,
          threshold: 0.01
        }
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
