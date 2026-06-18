import { describe, expect, it } from 'vitest'
import { feedSeenOnAllowlistFromSubRequests } from './feed-seen-on-allowlist'

describe('feedSeenOnAllowlistFromSubRequests', () => {
  it('merges relay URLs from multiple subrequest groups', () => {
    const urls = feedSeenOnAllowlistFromSubRequests(
      [{ urls: ['wss://a.example/'], filter: { kinds: [1] } }],
      [{ urls: ['wss://b.example/', 'wss://a.example/'], filter: { kinds: [1] } }]
    )
    expect(urls).toEqual(['wss://a.example/', 'wss://b.example/'])
  })

  it('returns empty when no requests', () => {
    expect(feedSeenOnAllowlistFromSubRequests(undefined, [])).toEqual([])
  })
})
