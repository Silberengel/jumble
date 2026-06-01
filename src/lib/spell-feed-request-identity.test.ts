import { describe, expect, it } from 'vitest'
import {
  computeSpellSubRequestsIdentityKey,
  isSpellSubRequestsFilterSuperset
} from './spell-feed-request-identity'
import type { TFeedSubRequest } from '@/types'

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
