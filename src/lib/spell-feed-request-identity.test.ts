import { describe, expect, it } from 'vitest'
import { legacyFeedSubscriptionKey } from '@/features/feed/descriptor'
import {
  computeSpellSubRequestsIdentityKey,
  isRelayUrlStrictSupersetIdentityKey,
  isSpellSubRequestsFilterSuperset,
  isSpellSubRequestsSameFiltersDifferentRelays
} from './spell-feed-request-identity'
import type { TFeedSubRequest } from '@/types'

describe('isRelayUrlStrictSupersetIdentityKey', () => {
  it('detects relay URL growth with legacyFeedSubscriptionKey object filters', () => {
    const base: TFeedSubRequest[] = [
      {
        urls: ['wss://relay.example/'],
        filter: { kinds: [1], limit: 150 }
      }
    ]
    const expanded: TFeedSubRequest[] = [
      {
        urls: ['wss://relay.example/', 'wss://inbox.example/'],
        filter: { kinds: [1], limit: 150 }
      }
    ]
    const prevKey = legacyFeedSubscriptionKey(base)
    const nextKey = legacyFeedSubscriptionKey(expanded)
    expect(isRelayUrlStrictSupersetIdentityKey(prevKey, nextKey)).toBe(true)
    expect(isRelayUrlStrictSupersetIdentityKey(nextKey, prevKey)).toBe(false)
  })
})

describe('isSpellSubRequestsSameFiltersDifferentRelays', () => {
  it('matches identical filters when relay URLs differ (legacy keys)', () => {
    const a: TFeedSubRequest[] = [
      { urls: ['wss://relay-a/'], filter: { kinds: [1], limit: 150 } }
    ]
    const b: TFeedSubRequest[] = [
      { urls: ['wss://relay-b/'], filter: { kinds: [1], limit: 150 } }
    ]
    const prevKey = legacyFeedSubscriptionKey(a)
    const nextKey = legacyFeedSubscriptionKey(b)
    expect(isSpellSubRequestsSameFiltersDifferentRelays(prevKey, nextKey)).toBe(true)
  })
})

describe('isSpellSubRequestsFilterSuperset', () => {
  it('detects when new shards add thread-watch filters', () => {
    const base: TFeedSubRequest[] = [
      {
        urls: ['wss://relay.example/'],
        filter: { limit: 200, '#p': ['abc'.repeat(32)] }
      }
    ]
    const expanded: TFeedSubRequest[] = [
      ...base,
      {
        urls: ['wss://relay.example/'],
        filter: { kinds: [1], limit: 200, '#e': ['d'.repeat(64)] }
      }
    ]
    const prevKey = computeSpellSubRequestsIdentityKey(base)
    const nextKey = computeSpellSubRequestsIdentityKey(expanded)
    expect(isSpellSubRequestsFilterSuperset(prevKey, nextKey)).toBe(true)
    expect(isSpellSubRequestsFilterSuperset(nextKey, prevKey)).toBe(false)
  })
})
