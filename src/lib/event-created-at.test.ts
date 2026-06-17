import { describe, expect, it } from 'vitest'
import {
  compareEventsNewestFirst,
  EVENT_CREATED_AT_MAX_FUTURE_DRIFT_SEC,
  getEventTimelineSortCreatedAt,
  isFutureEventCreatedAt,
  isPlausibleEventCreatedAt,
  normalizeEventCreatedAtSec
} from '@/lib/event-created-at'
import type { Event } from 'nostr-tools'

const NOW = 1_700_000_000

const ATPROTO_PROXY_SPAM: Event = {
  kind: 1,
  id: '2f99b9a8418df688728fbc763cd442e9ab6e570b4fa362abfc4bf8cb9f030b60',
  pubkey: '394b6923d5bc126cd42ec1a645f04c3ab7e2d62a80b15bf077d6bb6a6bd9a9b7',
  created_at: 4_130_944_797,
  tags: [
    [
      'proxy',
      'at://did:plc:2t622budf364qkodu3skkp5d/app.bsky.feed.post/3lbuvh5yqct2m',
      'atproto'
    ]
  ],
  content: 'test',
  sig: 'ca467c72557efd49293c687bd0c5858ba92168f9a057bd0cedb2a1d8eb5cbb5f22202eddaa5ccaa8ef2a54e68eea12850bafa009cbcd0fb24a1a8afa49675455'
}

describe('normalizeEventCreatedAtSec', () => {
  it('coerces numeric strings', () => {
    expect(normalizeEventCreatedAtSec(String(NOW - 60))).toBe(NOW - 60)
  })
})

describe('isFutureEventCreatedAt', () => {
  it('treats timestamps beyond drift as future', () => {
    expect(isFutureEventCreatedAt(NOW + EVENT_CREATED_AT_MAX_FUTURE_DRIFT_SEC + 1, NOW)).toBe(true)
    expect(isFutureEventCreatedAt(ATPROTO_PROXY_SPAM.created_at, NOW)).toBe(true)
  })

  it('allows small clock skew', () => {
    expect(isFutureEventCreatedAt(NOW + 30, NOW)).toBe(false)
  })
})

describe('isPlausibleEventCreatedAt', () => {
  it('rejects far-future timestamps', () => {
    expect(isPlausibleEventCreatedAt(ATPROTO_PROXY_SPAM.created_at, NOW)).toBe(false)
    expect(isPlausibleEventCreatedAt(NOW + EVENT_CREATED_AT_MAX_FUTURE_DRIFT_SEC + 1, NOW)).toBe(
      false
    )
  })

  it('accepts timestamps at or before now and within drift', () => {
    expect(isPlausibleEventCreatedAt(NOW - 60, NOW)).toBe(true)
    expect(isPlausibleEventCreatedAt(NOW, NOW)).toBe(true)
    expect(isPlausibleEventCreatedAt(NOW + 30, NOW)).toBe(true)
  })
})

describe('getEventTimelineSortCreatedAt', () => {
  it('sinks bogus timestamps to 0', () => {
    expect(getEventTimelineSortCreatedAt(ATPROTO_PROXY_SPAM, NOW)).toBe(0)
  })
})

describe('compareEventsNewestFirst', () => {
  it('orders a normal note ahead of a far-future timestamp', () => {
    const normal: Event = { ...ATPROTO_PROXY_SPAM, id: 'b'.repeat(64), created_at: NOW - 120 }
    expect(compareEventsNewestFirst(normal, ATPROTO_PROXY_SPAM, NOW)).toBeLessThan(0)
    expect(compareEventsNewestFirst(ATPROTO_PROXY_SPAM, normal, NOW)).toBeGreaterThan(0)
  })
})
