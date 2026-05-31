import { describe, expect, it } from 'vitest'
import { feedRelayPolicyUrls } from '@/features/feed/relay-policy'
import { AGGR_NOSTR_LAND_WSS } from '@/lib/nostr-land-aggr'
import { buildAllFavoritesFeedRelayUrls, stripNostrLandAggrFromRelayUrls } from '@/lib/home-feed-relays'
import { buildWispTrendingNotesRelayUrl, isWispTrendingNotesRelayUrl } from '@/lib/wisp-trending-relay'
import {
  setRestrictConnectionsToMetadataRelaysOnly,
  setViewerPersonalRelayKeys
} from '@/lib/read-only-relay-personal'

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

  it('metadata-only policy omits wisp trending from home feed relay list', () => {
    setRestrictConnectionsToMetadataRelaysOnly(true)
    setViewerPersonalRelayKeys(new Set(['wss://relay.example.com/']), { viewerActive: true })
    const wisp = buildWispTrendingNotesRelayUrl()
    const urls = buildAllFavoritesFeedRelayUrls(['wss://relay.example.com/'], [], [wisp])
    expect(urls).toContain('wss://relay.example.com/')
    expect(urls.some((u) => isWispTrendingNotesRelayUrl(u))).toBe(false)
    setRestrictConnectionsToMetadataRelaysOnly(false)
    setViewerPersonalRelayKeys(new Set(), { viewerActive: false })
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
})
