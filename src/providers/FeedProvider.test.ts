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

  it('personal-relay policy omits wisp trending from home feed relay list', () => {
    setViewerPersonalRelayKeys(new Set(['wss://relay.example.com/']), { viewerActive: true })
    const urls = buildAllFavoritesFeedRelayUrls(['wss://relay.example.com/'], [], [])
    expect(urls).toContain('wss://relay.example.com/')
    expect(urls.some((u) => isWispTrendingNotesRelayUrl(u))).toBe(false)
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

  it('falls back to DEFAULT_FAVORITE_RELAYS when favorites and extras are empty', () => {
    setViewerPersonalRelayKeys(new Set(), { viewerActive: false })
    const defaultsOnly = buildHomeDefaultFavoriteRelayUrls([])
    expect(defaultsOnly.length).toBeGreaterThan(0)
    const urls = buildAllFavoritesFeedRelayUrls([], [], [], false)
    const defaultHosts = new Set(
      DEFAULT_FAVORITE_RELAYS.map((u) => {
        try {
          return new URL(u.replace(/^wss:\/\//i, 'https://')).hostname.toLowerCase()
        } catch {
          return ''
        }
      }).filter(Boolean)
    )
    expect(urls.length).toBeGreaterThan(0)
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
  })

  it('omits default-favorites fallback under personal-relay policy', () => {
    setViewerPersonalRelayKeys(new Set(['wss://relay.example.com/']), { viewerActive: true })
    expect(buildAllFavoritesFeedRelayUrls([], [], [], false)).toEqual([])
    expect(buildHomeDefaultFavoriteRelayUrls([])).toEqual([])
    setViewerPersonalRelayKeys(new Set(), { viewerActive: false })
  })
})
