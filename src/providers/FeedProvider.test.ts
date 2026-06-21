import { describe, expect, it } from 'vitest'
import { DEFAULT_FAVORITE_RELAYS } from '@/constants'
import { feedRelayPolicyUrls } from '@/features/feed/relay-policy'
import { AGGR_NOSTR_LAND_WSS } from '@/lib/nostr-land-aggr'
import {
  buildAllFavoritesFeedRelayUrls,
  buildHomeDefaultFavoriteRelayUrls,
  stripNostrLandAggrFromRelayUrls
} from '@/lib/home-feed-relays'
import { buildWispTrendingNotesRelayUrl, isWispTrendingNotesRelayUrl } from '@/lib/wisp-trending-relay'
import {
  setViewerPersonalRelayKeys
} from '@/lib/read-only-relay-personal'
import { normalizeAnyRelayUrl } from '@/lib/url'

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

  it('personal-relay policy still includes wisp trending on the home feed stack', () => {
    setViewerPersonalRelayKeys(new Set(['wss://relay.example.com/']), { viewerActive: true })
    const urls = buildAllFavoritesFeedRelayUrls(['wss://relay.example.com/'], [], [])
    expect(urls).toContain('wss://relay.example.com/')
    expect(urls.some((u) => isWispTrendingNotesRelayUrl(u))).toBe(true)
    setViewerPersonalRelayKeys(new Set(), { viewerActive: false })
  })

  it('includes trending from favorites tier without extra feed relays', () => {
    const urls = buildAllFavoritesFeedRelayUrls(['wss://relay.example.com/'], [], [])
    expect(urls).toContain('wss://relay.example.com/')
    expect(urls).toContain(buildWispTrendingNotesRelayUrl())
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

  it('supplements DEFAULT_FAVORITE_RELAYS when the viewer has no configured favorites', () => {
    setViewerPersonalRelayKeys(new Set(['wss://theforest.nostr1.com/']), { viewerActive: true })
    const urls = buildAllFavoritesFeedRelayUrls(['wss://theforest.nostr1.com/'], [], [], false, {
      supplementDefaultFavorites: true
    })
    const defaultHosts = new Set(
      DEFAULT_FAVORITE_RELAYS.map((u) => {
        try {
          return new URL(u.replace(/^wss:\/\//i, 'https://')).hostname.toLowerCase()
        } catch {
          return ''
        }
      }).filter(Boolean)
    )
    for (const host of defaultHosts) {
      expect(
        urls.some((u) => {
          try {
            return (
              new URL((normalizeAnyRelayUrl(u) || u).replace(/^wss:\/\//i, 'https://')).hostname.toLowerCase() ===
              host
            )
          } catch {
            return false
          }
        })
      ).toBe(true)
    }
    setViewerPersonalRelayKeys(new Set(), { viewerActive: false })
  })

  it('does not supplement defaults without supplementDefaultFavorites under personal-relay policy', () => {
    setViewerPersonalRelayKeys(new Set(['wss://relay.example.com/']), { viewerActive: true })
    const urls = buildAllFavoritesFeedRelayUrls(['wss://relay.example.com/'], [], [], false)
    expect(urls.some((u) => u.includes('relay.example.com'))).toBe(true)
    expect(urls.some((u) => u.includes('theforest.nostr1.com'))).toBe(false)
    expect(urls.some((u) => u.includes('nostr.land'))).toBe(false)
    expect(buildHomeDefaultFavoriteRelayUrls([]).length).toBeGreaterThan(0)
    setViewerPersonalRelayKeys(new Set(), { viewerActive: false })
  })
})
