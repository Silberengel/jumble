import { describe, expect, it, vi } from 'vitest'
import {
  markMediaUrlRevealed,
  markMediaUrlsRevealed,
  subscribeRevealedMedia,
  wasMediaUrlRevealed
} from '@/lib/revealed-media-session'

describe('revealed-media-session', () => {
  it('tracks revealed URLs by cleaned key', () => {
    markMediaUrlRevealed('https://cdn.example.com/a.jpg?utm_source=feed')
    expect(wasMediaUrlRevealed('https://cdn.example.com/a.jpg')).toBe(true)
  })

  it('notifies subscribers when a new URL is revealed', () => {
    const listener = vi.fn()
    const unsub = subscribeRevealedMedia(listener)
    markMediaUrlRevealed('https://cdn.example.com/b.jpg')
    expect(listener).toHaveBeenCalledTimes(1)
    markMediaUrlRevealed('https://cdn.example.com/b.jpg')
    expect(listener).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('marks multiple URL variants in one batch', () => {
    markMediaUrlsRevealed([
      'https://blossom.primal.net/abc.jpg',
      'https://r2a.primal.net/uploads2/a/bc/abc.jpg'
    ])
    expect(wasMediaUrlRevealed('https://r2a.primal.net/uploads2/a/bc/abc.jpg')).toBe(true)
  })
})
