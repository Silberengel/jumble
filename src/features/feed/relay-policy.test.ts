import { describe, expect, it } from 'vitest'
import { applyFeedRelayPolicy } from './relay-policy'

describe('applyFeedRelayPolicy', () => {
  it('prepends aggr.nostr.land for read feeds before caps', () => {
    const result = applyFeedRelayPolicy(
      [{ source: 'viewer-read', urls: ['wss://reader-a.example/', 'wss://reader-b.example/'] }],
      {
        operation: 'read',
        maxRelays: 2,
        applySocialKindBlockedFilter: false,
        nostrLandAggrEligible: true
      }
    )

    expect(result.urls).toEqual(['wss://aggr.nostr.land/', 'wss://reader-a.example/'])
    expect(result.dropped.some((drop) => drop.reason === 'over-cap')).toBe(true)
  })

  it('keeps favorites feed strictly curated and removes the aggregator', () => {
    const result = applyFeedRelayPolicy(
      [{ source: 'favorites', urls: ['wss://relay.example/', 'wss://aggr.nostr.land/'] }],
      { operation: 'favorites-feed', nostrLandAggr: 'never' }
    )

    expect(result.urls).toEqual(['wss://relay.example/'])
    expect(result.dropped).toContainEqual(
      expect.objectContaining({
        normalizedUrl: 'wss://aggr.nostr.land/',
        reason: 'favorites-feed-aggr'
      })
    )
  })

  it('always lets user-blocked relays win', () => {
    const result = applyFeedRelayPolicy(
      [{ source: 'viewer-read', urls: ['wss://relay.example/', 'wss://aggr.nostr.land/'] }],
      {
        operation: 'read',
        blockedRelays: ['wss://aggr.nostr.land/'],
        applySocialKindBlockedFilter: false,
        nostrLandAggrEligible: true
      }
    )

    expect(result.urls).toEqual(['wss://relay.example/'])
    expect(result.dropped).toContainEqual(
      expect.objectContaining({
        normalizedUrl: 'wss://aggr.nostr.land/',
        reason: 'user-blocked'
      })
    )
  })

  it('excludes read-only relays for write operations', () => {
    const result = applyFeedRelayPolicy(
      [{ source: 'fast-read', urls: ['wss://aggr.nostr.land/', 'wss://relay.example/'] }],
      { operation: 'write', applySocialKindBlockedFilter: false }
    )

    expect(result.urls).toEqual(['wss://relay.example/'])
    expect(result.dropped).toContainEqual(
      expect.objectContaining({
        normalizedUrl: 'wss://aggr.nostr.land/',
        reason: 'read-only-for-write'
      })
    )
  })
})
