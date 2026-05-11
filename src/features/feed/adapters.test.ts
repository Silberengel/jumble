import { describe, expect, it } from 'vitest'
import {
  calendarFeedDescriptor,
  embedFeedDescriptor,
  favoritesFeedDescriptor,
  homeFeedDescriptor,
  profileFeedDescriptor,
  relayFeedDescriptor,
  repliesFeedDescriptor,
  searchFeedDescriptor,
  spellsFeedDescriptor,
  threadFeedDescriptor
} from './adapters'

const requests = [{ urls: ['wss://relay.example/'], filter: { kinds: [1], limit: 20 } }]

describe('feed surface adapters', () => {
  it('marks timeline surfaces as live and paginated by default', () => {
    for (const descriptor of [
      homeFeedDescriptor(requests),
      favoritesFeedDescriptor(requests),
      relayFeedDescriptor(requests, 'wss://relay.example/'),
      profileFeedDescriptor(requests, 'pubkey'),
      spellsFeedDescriptor(requests),
      calendarFeedDescriptor(requests)
    ]) {
      expect(descriptor.mode).toBe('live')
      expect(descriptor.pagination.enabled).toBe(true)
      expect(descriptor.source.cache).toBe('stale-while-refresh')
    }
  })

  it('marks focused fetch surfaces as one-shot', () => {
    for (const descriptor of [
      repliesFeedDescriptor(requests, 'reply-root'),
      threadFeedDescriptor(requests, 'thread-root'),
      embedFeedDescriptor(requests, 'embedded-note'),
      searchFeedDescriptor(requests, 'search:nostr')
    ]) {
      expect(descriptor.mode).toBe('one-shot')
    }
  })

  it('keeps surface identity separate for equivalent requests', () => {
    expect(homeFeedDescriptor(requests).key).not.toBe(favoritesFeedDescriptor(requests).key)
  })
})
