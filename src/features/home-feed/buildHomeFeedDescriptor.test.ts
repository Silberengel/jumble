import { describe, expect, it } from 'vitest'
import {
  buildHomeFeedDescriptorBundle,
  buildHomeFeedSubRequests
} from './buildHomeFeedDescriptor'
import { HOME_FEED_RELAY_SOURCE_FAVORITES } from '@/lib/home-feed-relay-source'

describe('buildHomeFeedDescriptorBundle', () => {
  it('returns null when no relay URLs', () => {
    expect(
      buildHomeFeedDescriptorBundle({
        homeFeedRelaySource: HOME_FEED_RELAY_SOURCE_FAVORITES,
        relayUrls: [],
        replyRelayUrls: [],
        showKinds: [1],
        listMode: 'postsAndReplies',
        seeAllFeedEvents: false
      })
    ).toBeNull()
  })

  it('builds stable keys for favorites vs relay-set', () => {
    const fav = buildHomeFeedDescriptorBundle({
      homeFeedRelaySource: HOME_FEED_RELAY_SOURCE_FAVORITES,
      relayUrls: ['wss://relay.example.com'],
      replyRelayUrls: ['wss://relay.example.com', 'wss://inbox.example.com'],
      showKinds: [1],
      listMode: 'posts',
      seeAllFeedEvents: false
    })
    const set = buildHomeFeedDescriptorBundle({
      homeFeedRelaySource: 'set-abc',
      relayUrls: ['wss://relay.example.com'],
      replyRelayUrls: ['wss://relay.example.com'],
      showKinds: [1],
      listMode: 'posts',
      seeAllFeedEvents: false
    })
    expect(fav?.subscriptionKey).toBe('home-all-favorites')
    expect(fav?.sinceScopeKey).toBe('all-favorites')
    expect(set?.subscriptionKey).toBe('home-relay-set:set-abc')
    expect(set?.sinceScopeKey).toBe('relay-set:set-abc')
    expect(set?.relaySetFeedOnly).toBe(true)
    expect(fav?.relaySetFeedOnly).toBe(false)
  })

  it('uses replies sub-requests when list mode includes replies', () => {
    const bundle = buildHomeFeedDescriptorBundle({
      homeFeedRelaySource: HOME_FEED_RELAY_SOURCE_FAVORITES,
      relayUrls: ['wss://a.example.com'],
      replyRelayUrls: ['wss://b.example.com'],
      showKinds: [1],
      listMode: 'postsAndReplies',
      seeAllFeedEvents: false
    })
    expect(bundle?.activeSubRequests[0]?.urls.some((u) => u.includes('b.example.com'))).toBe(
      true
    )
  })
})

describe('buildHomeFeedSubRequests', () => {
  it('falls back replies to notes URLs when reply list empty', () => {
    const { replies } = buildHomeFeedSubRequests(
      ['wss://a.example.com'],
      [],
      HOME_FEED_RELAY_SOURCE_FAVORITES,
      [1]
    )
    expect(replies[0]?.urls.some((u) => u.includes('a.example.com'))).toBe(true)
  })
})
