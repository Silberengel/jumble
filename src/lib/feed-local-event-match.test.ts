import { describe, expect, it } from 'vitest'
import type { Event } from 'nostr-tools'
import { eventMatchesLocalFeedFilter } from './feed-local-event-match'

function event(overrides: Partial<Event> = {}): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1000,
    kind: 1,
    tags: [
      ['p', 'c'.repeat(64)],
      ['t', 'Nostr'],
      ['d', 'article-1']
    ],
    content: 'hello local cache',
    sig: 'd'.repeat(128),
    ...overrides
  }
}

describe('eventMatchesLocalFeedFilter', () => {
  it('matches ids, authors, kinds, time windows, tags, and search', () => {
    expect(
      eventMatchesLocalFeedFilter(event(), {
        ids: ['a'.repeat(64)],
        authors: ['b'.repeat(64)],
        kinds: [1],
        since: 900,
        until: 1100,
        '#p': ['c'.repeat(64)],
        '#t': ['nostr'],
        search: 'local'
      })
    ).toBe(true)
  })

  it('matches hex mention tags case-insensitively for local cache warmup', () => {
    expect(
      eventMatchesLocalFeedFilter(event({ tags: [['p', 'C'.repeat(64)]] }), {
        '#p': ['c'.repeat(64)]
      })
    ).toBe(true)
  })

  it('matches uppercase E tags when filter uses #e', () => {
    expect(
      eventMatchesLocalFeedFilter(event({ tags: [['E', 'e'.repeat(64)]] }), {
        '#e': ['e'.repeat(64)]
      })
    ).toBe(true)
  })

  it('rejects events outside any filter constraint', () => {
    expect(eventMatchesLocalFeedFilter(event({ kind: 6 }), { kinds: [1] })).toBe(false)
    expect(eventMatchesLocalFeedFilter(event(), { since: 1001 })).toBe(false)
    expect(eventMatchesLocalFeedFilter(event(), { '#e': ['e'.repeat(64)] })).toBe(false)
    expect(eventMatchesLocalFeedFilter(event(), { search: 'relay-only' })).toBe(false)
  })
})
