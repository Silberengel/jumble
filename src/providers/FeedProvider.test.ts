import { describe, expect, it } from 'vitest'
import { FAST_READ_RELAY_URLS } from '@/constants'
import { feedRelayPolicyUrls } from '@/features/feed/relay-policy'
import { AGGR_NOSTR_LAND_WSS } from '@/lib/nostr-land-aggr'
import { buildRelayPulseQueryRelayUrls, buildAllFavoritesFeedRelayUrls, stripNostrLandAggrFromRelayUrls } from '@/lib/home-feed-relays'
import { buildWispTrendingNotesRelayUrl } from '@/lib/wisp-trending-relay'
import type { Event } from 'nostr-tools'

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

  it('home reply merge omits aggr even when listed on viewer read relays', () => {
    const merged = stripNostrLandAggrFromRelayUrls(
      feedRelayPolicyUrls(
        [
          { source: 'favorites', urls: ['wss://relay.example/'] },
          { source: 'viewer-read', urls: [AGGR_NOSTR_LAND_WSS, 'wss://inbox.example/'] }
        ],
        {
          operation: 'read',
          blockedRelays: [],
          nostrLandAggr: 'never',
          applySocialKindBlockedFilter: false,
          allowThirdPartyLocalRelays: true
        }
      )
    )
    expect(merged).not.toContain(AGGR_NOSTR_LAND_WSS)
    expect(merged).toContain('wss://relay.example/')
    expect(merged).toContain('wss://inbox.example/')
  })

  it('stripNostrLandAggrFromRelayUrls removes aggr with trailing slash and hostname variants', () => {
    const stripped = stripNostrLandAggrFromRelayUrls([
      'wss://relay.example/',
      'wss://aggr.nostr.land/',
      AGGR_NOSTR_LAND_WSS,
      'wss://AGGR.nostr.land'
    ])
    expect(stripped).toEqual(['wss://relay.example/'])
  })

  it('relay pulse stack excludes global fast-read and aggr', () => {
    const nineReadTags: string[][] = Array.from({ length: 9 }, (_, i) => [
      'r',
      `wss://many-${i}.example/`,
      'read'
    ])
    const oversizedCacheList = {
      kind: 10012,
      tags: [...nineReadTags],
      content: '',
      created_at: 0,
      pubkey: 'a'.repeat(64),
      id: 'b'.repeat(64),
      sig: 'c'.repeat(128)
    } satisfies Event

    const urls = buildRelayPulseQueryRelayUrls({
      viewerPubkey: 'd'.repeat(64),
      favoriteRelayUrls: ['wss://fav.example/'],
      blockedRelays: [],
      relayList: { read: ['wss://nip65.example/'], httpRead: ['https://http-index.example/'] },
      cacheRelayListEvent: oversizedCacheList,
      httpRelayListEvent: null
    })

    for (const u of FAST_READ_RELAY_URLS) {
      expect(urls).not.toContain(u)
    }
    expect(urls).not.toContain(AGGR_NOSTR_LAND_WSS)
    expect(urls).not.toContain('wss://aggr.nostr.land/')
    expect(urls.filter((u) => u.startsWith('wss://many-')).length).toBe(8)
  })
})
