import { describe, expect, it } from 'vitest'
import { AGGR_NOSTR_LAND_WSS } from '@/lib/nostr-land-aggr'
import { buildWispTrendingNotesRelayUrl } from '@/lib/wisp-trending-relay'
import { buildAllFavoritesFeedRelayUrls } from '@/lib/home-feed-relays'

describe('home feed relay policy', () => {
  it('keeps aggr.nostr.land out of the main home feed', () => {
    const urls = buildAllFavoritesFeedRelayUrls(
      ['wss://relay.example.com/', AGGR_NOSTR_LAND_WSS],
      [],
      [buildWispTrendingNotesRelayUrl(), AGGR_NOSTR_LAND_WSS]
    )

    expect(urls).toContain('wss://relay.example.com/')
    expect(urls).toContain(buildWispTrendingNotesRelayUrl())
    expect(urls).not.toContain('wss://aggr.nostr.land/')
    expect(urls).not.toContain(AGGR_NOSTR_LAND_WSS)
  })
})
