import { describe, expect, it } from 'vitest'

/** Pure math used by {@link useVisualViewportInset} — safe to unit test without jsdom visualViewport. */
function readVisualViewportInsetFrom(
  innerHeight: number,
  vv: { height: number; offsetTop: number } | null
) {
  if (!vv) {
    return { height: innerHeight, bottomInset: 0, offsetTop: 0 }
  }
  const height = Math.round(vv.height)
  const offsetTop = Math.round(vv.offsetTop)
  const bottomInset = Math.max(0, Math.round(innerHeight - (vv.offsetTop + vv.height)))
  return { height, bottomInset, offsetTop }
}

describe('visual viewport inset math', () => {
  it('returns zero inset when keyboard is closed', () => {
    expect(readVisualViewportInsetFrom(800, { height: 800, offsetTop: 0 })).toEqual({
      height: 800,
      bottomInset: 0,
      offsetTop: 0
    })
  })

  it('computes keyboard inset when viewport shrinks', () => {
    expect(readVisualViewportInsetFrom(800, { height: 450, offsetTop: 0 })).toEqual({
      height: 450,
      bottomInset: 350,
      offsetTop: 0
    })
  })

  it('accounts for offsetTop when browser shifts visible viewport', () => {
    expect(readVisualViewportInsetFrom(800, { height: 400, offsetTop: 50 })).toEqual({
      height: 400,
      bottomInset: 350,
      offsetTop: 50
    })
  })
})
