import { describe, expect, it } from 'vitest'
import {
  HOME_FEED_RELAY_SOURCE_FAVORITES,
  homeFeedSubscriptionKeys,
  isHomePrimaryFeedSubscriptionKey,
  normalizeHomeFeedRelaySource,
  resolveHomeFeedPrimaryRelayUrls
} from '@/lib/home-feed-relay-source'

describe('home-feed-relay-source', () => {
  it('resolves favorite relays by default', () => {
    const result = resolveHomeFeedPrimaryRelayUrls(
      HOME_FEED_RELAY_SOURCE_FAVORITES,
      ['wss://a.example'],
      []
    )
    expect(result.urls).toEqual(['wss://a.example'])
    expect(result.effectiveSource).toBe(HOME_FEED_RELAY_SOURCE_FAVORITES)
  })

  it('resolves a relay set and falls back when missing', () => {
    const sets = [{ id: 'set-1', aTag: [], name: 'Mine', relayUrls: ['wss://b.example'] }]
    expect(resolveHomeFeedPrimaryRelayUrls('set-1', ['wss://a.example'], sets).urls).toEqual([
      'wss://b.example'
    ])
    expect(resolveHomeFeedPrimaryRelayUrls('gone', ['wss://a.example'], sets).effectiveSource).toBe(
      HOME_FEED_RELAY_SOURCE_FAVORITES
    )
  })

  it('builds subscription keys for favorites and relay sets', () => {
    expect(homeFeedSubscriptionKeys(HOME_FEED_RELAY_SOURCE_FAVORITES)).toEqual({
      subscriptionKey: 'home-all-favorites',
      timelineScopeKey: 'all-favorites'
    })
    expect(homeFeedSubscriptionKeys('set-1')).toEqual({
      subscriptionKey: 'home-relay-set:set-1',
      timelineScopeKey: 'relay-set:set-1'
    })
  })

  it('recognizes home primary feed subscription keys', () => {
    expect(isHomePrimaryFeedSubscriptionKey('home-all-favorites')).toBe(true)
    expect(isHomePrimaryFeedSubscriptionKey('home-relay-set:abc')).toBe(true)
    expect(isHomePrimaryFeedSubscriptionKey('profile:abc')).toBe(false)
  })

  it('normalizes invalid relay-set selections', () => {
    expect(normalizeHomeFeedRelaySource('missing', [])).toBe(HOME_FEED_RELAY_SOURCE_FAVORITES)
    expect(normalizeHomeFeedRelaySource('set-1', [{ id: 'set-1', aTag: [], name: 'X', relayUrls: [] }])).toBe(
      'set-1'
    )
  })
})
