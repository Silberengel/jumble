import { describe, expect, it } from 'vitest'
import {
  buildFeedSessionSnapshotKey,
  createFeedDescriptor,
  legacyFeedSubscriptionKey,
  stableFeedKindKey
} from './descriptor'

describe('FeedDescriptor canonicalization', () => {
  it('uses the same key for equivalent relay and filter ordering', () => {
    const a = createFeedDescriptor({
      surface: 'home',
      requests: [
        {
          urls: ['wss://relay-b.example/', 'wss://relay-a.example/'],
          filter: { kinds: [30023, 1], '#p': ['b', 'a'], limit: 50 }
        }
      ]
    })
    const b = createFeedDescriptor({
      surface: 'home',
      requests: [
        {
          urls: ['wss://relay-a.example/', 'wss://relay-b.example/'],
          filter: { '#p': ['a', 'b'], limit: 50, kinds: [1, 30023] }
        }
      ]
    })

    expect(a.key).toBe(b.key)
  })

  it('separates surfaces even when requests match', () => {
    const requests = [{ urls: ['wss://relay.example/'], filter: { kinds: [1], limit: 50 } }]

    expect(createFeedDescriptor({ surface: 'home', requests }).key).not.toBe(
      createFeedDescriptor({ surface: 'notifications', requests }).key
    )
  })

  it('exposes a stable legacy subscription key for old NoteList callers', () => {
    const first = legacyFeedSubscriptionKey([
      { urls: ['wss://b.example/', 'wss://a.example/'], filter: { kinds: [7, 1], limit: 20 } }
    ])
    const second = legacyFeedSubscriptionKey([
      { urls: ['wss://a.example/', 'wss://b.example/'], filter: { limit: 20, kinds: [1, 7] } }
    ])

    expect(first).toBe(second)
  })

  it('builds stable NoteList session snapshot identities outside the component', () => {
    const kindsKey = stableFeedKindKey([30023, 1])
    expect(kindsKey).toBe('[1,30023]')

    expect(
      buildFeedSessionSnapshotKey({
        feedKey: 'feed-a',
        kindsKey,
        showKind1OPs: true,
        showKind1Replies: false,
        showKind1111: true,
        seeAllFeedEvents: false
      })
    ).toBe(
      JSON.stringify({
        feed: 'feed-a',
        kinds: '[1,30023]',
        op: true,
        rep: false,
        c1111: true,
        seeAll: false
      })
    )
  })
})
