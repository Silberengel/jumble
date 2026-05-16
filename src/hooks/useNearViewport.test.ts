import { elementIsNearViewport } from '@/hooks/useNearViewport'
import { describe, expect, it } from 'vitest'

describe('elementIsNearViewport', () => {
  it('returns true when element rect overlaps expanded viewport', () => {
    const el = {
      getBoundingClientRect: () => ({
        top: 10,
        bottom: 50,
        left: 0,
        right: 100
      })
    } as HTMLElement
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true })
    expect(elementIsNearViewport(el, 100)).toBe(true)
  })

  it('returns false when element is far below the fold', () => {
    const el = {
      getBoundingClientRect: () => ({
        top: 2000,
        bottom: 2100,
        left: 0,
        right: 100
      })
    } as HTMLElement
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true })
    expect(elementIsNearViewport(el, 50)).toBe(false)
  })
})
