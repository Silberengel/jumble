import { useCallback, useEffect, useRef } from 'react'

/** Swipes must start within this distance of the left screen edge (iOS-style back). */
export const MOBILE_SWIPE_BACK_EDGE_PX = 28
export const MOBILE_SWIPE_BACK_MIN_PX = 56
export const MOBILE_SWIPE_BACK_DOMINANCE = 1.25

const SWIPE_BACK_DEBOUNCE_MS = 400

let lastSwipeBackAt = 0

export type UseMobileSwipeBackOnElementOptions = {
  enabled?: boolean
  edgePx?: number
}

type Grab = { x: number; y: number; pointerId: number }

function isPrimaryPointerButton(button: number): boolean {
  return button === 0 || button === -1
}

export function tryMobileSwipeBackFromGesture(
  grab: Grab | null,
  clientX: number,
  clientY: number,
  pointerId: number,
  onBack: () => void
): boolean {
  if (!grab || grab.pointerId !== pointerId) return false
  const dx = clientX - grab.x
  const dy = clientY - grab.y
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (dx < MOBILE_SWIPE_BACK_MIN_PX || ax < ay * MOBILE_SWIPE_BACK_DOMINANCE) return false
  const now = Date.now()
  if (now - lastSwipeBackAt < SWIPE_BACK_DEBOUNCE_MS) return true
  lastSwipeBackAt = now
  onBack()
  return true
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
  const grabRef = useRef<Grab | null>(null)

  const releaseCapture = (el: HTMLElement, pointerId: number) => {
    if (pointerId < 0) return
    try {
      if (el.hasPointerCapture?.(pointerId)) el.releasePointerCapture(pointerId)
    } catch {
      /* ignore */
    }
  }

  const finishSwipe = useCallback(
    (clientX: number, clientY: number, pointerId: number, el: HTMLElement) => {
      const handled = tryMobileSwipeBackFromGesture(
        grabRef.current,
        clientX,
        clientY,
        pointerId,
        () => onBackRef.current()
      )
      grabRef.current = null
      releaseCapture(el, pointerId)
      return handled
    },
    []
  )

  useEffect(() => {
    if (!element || !enabled) return

    const onPointerDown = (e: PointerEvent) => {
      if (!isPrimaryPointerButton(e.button) || e.clientX > edgePx) return
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

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const touch = e.touches[0]
      if (touch.clientX > edgePx) return
      grabRef.current = { x: touch.clientX, y: touch.clientY, pointerId: touch.identifier }
    }

    const onTouchEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0]
      if (!touch) return
      finishSwipe(touch.clientX, touch.clientY, touch.identifier, element)
    }

    const onTouchCancel = () => {
      grabRef.current = null
    }

    const capture = { capture: true } as const
    element.addEventListener('pointerdown', onPointerDown, capture)
    element.addEventListener('pointerup', onPointerUp, capture)
    element.addEventListener('pointercancel', onPointerCancel, capture)
    element.addEventListener('touchstart', onTouchStart, { ...capture, passive: true })
    element.addEventListener('touchend', onTouchEnd, capture)
    element.addEventListener('touchcancel', onTouchCancel, capture)
    return () => {
      element.removeEventListener('pointerdown', onPointerDown, capture)
      element.removeEventListener('pointerup', onPointerUp, capture)
      element.removeEventListener('pointercancel', onPointerCancel, capture)
      element.removeEventListener('touchstart', onTouchStart, capture)
      element.removeEventListener('touchend', onTouchEnd, capture)
      element.removeEventListener('touchcancel', onTouchCancel, capture)
    }
  }, [element, enabled, edgePx, finishSwipe])
}
