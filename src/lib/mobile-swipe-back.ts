import { useCallback, useEffect, useRef } from 'react'

/** Swipes must start within this distance of the left screen edge (iOS-style back). */
export const MOBILE_SWIPE_BACK_EDGE_PX = 28
export const MOBILE_SWIPE_BACK_MIN_PX = 56
export const MOBILE_SWIPE_BACK_DOMINANCE = 1.25

export type UseMobileSwipeBackOnElementOptions = {
  enabled?: boolean
  edgePx?: number
}

/**
 * Detect a rightward swipe from the left edge and invoke `onBack` (close secondary / drawer).
 * Radix sheets and SPA history often block the native browser back gesture on mobile.
 */
export function useMobileSwipeBackOnElement(
  element: HTMLElement | null,
  onBack: () => void,
  options: UseMobileSwipeBackOnElementOptions = {}
) {
  const { enabled = true, edgePx = MOBILE_SWIPE_BACK_EDGE_PX } = options
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack
  const grabRef = useRef<{ x: number; y: number; pointerId: number } | null>(null)

  const releaseCapture = (el: HTMLElement, pointerId: number) => {
    try {
      if (el.hasPointerCapture?.(pointerId)) el.releasePointerCapture(pointerId)
    } catch {
      /* ignore */
    }
  }

  const finishSwipe = useCallback((clientX: number, clientY: number, pointerId: number, el: HTMLElement) => {
    const grab = grabRef.current
    grabRef.current = null
    releaseCapture(el, pointerId)
    if (!grab || grab.pointerId !== pointerId) return
    const dx = clientX - grab.x
    const dy = clientY - grab.y
    const ax = Math.abs(dx)
    const ay = Math.abs(dy)
    if (dx < MOBILE_SWIPE_BACK_MIN_PX || ax < ay * MOBILE_SWIPE_BACK_DOMINANCE) return
    onBackRef.current()
  }, [])

  useEffect(() => {
    if (!element || !enabled) return

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.clientX > edgePx) return
      grabRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId }
      try {
        element.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      finishSwipe(e.clientX, e.clientY, e.pointerId, element)
    }

    const onPointerCancel = (e: PointerEvent) => {
      grabRef.current = null
      releaseCapture(element, e.pointerId)
    }

    element.addEventListener('pointerdown', onPointerDown)
    element.addEventListener('pointerup', onPointerUp)
    element.addEventListener('pointercancel', onPointerCancel)
    return () => {
      element.removeEventListener('pointerdown', onPointerDown)
      element.removeEventListener('pointerup', onPointerUp)
      element.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [element, enabled, edgePx, finishSwipe])
}
