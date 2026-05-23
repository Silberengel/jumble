import { describe, expect, it, vi } from 'vitest'
import {
  MOBILE_SWIPE_BACK_MIN_PX,
  tryMobileSwipeBackFromGesture
} from './mobile-swipe-back'

describe('tryMobileSwipeBackFromGesture', () => {
  it('invokes onBack for a rightward edge swipe', () => {
    const onBack = vi.fn()
    const grab = { x: 12, y: 100, pointerId: 1 }
    const handled = tryMobileSwipeBackFromGesture(
      grab,
      grab.x + MOBILE_SWIPE_BACK_MIN_PX + 8,
      grab.y + 4,
      1,
      onBack
    )
    expect(handled).toBe(true)
    expect(onBack).toHaveBeenCalledTimes(1);
  })

  it('ignores leftward swipes', () => {
    const onBack = vi.fn()
    tryMobileSwipeBackFromGesture({ x: 12, y: 100, pointerId: 1 }, 4, 100, 1, onBack)
    expect(onBack).not.toHaveBeenCalled()
  })

  it('ignores mostly vertical swipes', () => {
    const onBack = vi.fn()
    tryMobileSwipeBackFromGesture({ x: 12, y: 100, pointerId: 1 }, 80, 220, 1, onBack)
    expect(onBack).not.toHaveBeenCalled()
  })
})
