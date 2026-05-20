import { describe, expect, it } from 'vitest'
import { ExtendedKind } from '@/constants'
import {
  getProfileAuthorWarmupSpec,
  isProfileTimelineSubscriptionKey
} from './profile-author-warmup-spec'

describe('getProfileAuthorWarmupSpec', () => {
  const authorHex = 'a'.repeat(64)

  it('returns spec when calendar #p shards omit authors', () => {
    const spec = getProfileAuthorWarmupSpec([
      {
        urls: ['wss://relay.example'],
        filter: { authors: [authorHex], kinds: [1], limit: 200 }
      },
      {
        urls: ['wss://relay.example'],
        filter: {
          kinds: [ExtendedKind.CALENDAR_EVENT_DATE],
          '#p': [authorHex],
          limit: 100
        }
      }
    ])
    expect(spec).toEqual({ author: authorHex, kinds: [1] })
  })

  it('detects profile feed subscription keys', () => {
    expect(isProfileTimelineSubscriptionKey('profile-feed-abc-1-500')).toBe(true)
    expect(isProfileTimelineSubscriptionKey('profile-posts-abc-1-200')).toBe(true)
    expect(isProfileTimelineSubscriptionKey('home-all-favorites')).toBe(false)
    expect(isProfileTimelineSubscriptionKey(null)).toBe(false)
  })

  it('returns null when no author shards', () => {
    expect(
      getProfileAuthorWarmupSpec([
        {
          urls: ['wss://relay.example'],
          filter: { kinds: [ExtendedKind.CALENDAR_EVENT_DATE], '#p': [authorHex], limit: 100 }
        }
      ])
    ).toBeNull()
  })
})
