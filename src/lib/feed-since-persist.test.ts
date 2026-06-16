import { describe, expect, it, beforeEach } from 'vitest'
import {
  applyPersistedFeedSinceToSubRequests,
  getPersistedFeedSince,
  persistFeedSince,
  resetPersistedFeedSinceForTests
} from './feed-since-persist'

describe('feed-since-persist', () => {
  beforeEach(() => {
    resetPersistedFeedSinceForTests()
  })

  it('persists and reads newest created_at per scope', () => {
    persistFeedSince('home', [{ id: 'a', created_at: 1000 } as never])
    persistFeedSince('home', [{ id: 'b', created_at: 900 } as never])
    expect(getPersistedFeedSince('home')).toBe(1000)
    persistFeedSince('home', [{ id: 'c', created_at: 1100 } as never])
    expect(getPersistedFeedSince('home')).toBe(1100)
  })

  it('applies since with overlap when no filter since/until', () => {
    persistFeedSince('home', [{ id: 'a', created_at: 2000 } as never])
    const out = applyPersistedFeedSinceToSubRequests(
      [{ urls: ['wss://r'], filter: { kinds: [1], limit: 50 } }],
      { scopeKey: 'home' }
    )
    expect(out[0]!.filter.since).toBe(2000 - 120)
  })

  it('skips when refresh flag or filter already has since', () => {
    persistFeedSince('home', [{ id: 'a', created_at: 2000 } as never])
    const skipped = applyPersistedFeedSinceToSubRequests(
      [{ urls: ['wss://r'], filter: { kinds: [1] } }],
      { scopeKey: 'home', skip: true }
    )
    expect(skipped[0]!.filter.since).toBeUndefined()

    const existing = applyPersistedFeedSinceToSubRequests(
      [{ urls: ['wss://r'], filter: { kinds: [1], since: 50 } }],
      { scopeKey: 'home' }
    )
    expect(existing[0]!.filter.since).toBe(50)
  })
})
