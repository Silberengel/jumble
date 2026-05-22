import { describe, expect, it, afterEach } from 'vitest'
import { AGGR_NOSTR_LAND_WSS } from '@/lib/nostr-land-aggr'
import {
  filterAggrNostrLandUnlessViewerEligible,
  getAggrAwareSearchRelayUrls,
  getViewerNostrLandAggrSearchRelayUrls,
  prependAggrForEventLookupRelayUrls,
  prependAggrNostrLandIfViewerEligible,
  relayUrlsIncludeCanonicalNostrLandRelay,
  syncViewerRelayStackNostrLandAggrEligible
} from '@/lib/nostr-land-relay-eligibility'

afterEach(() => {
  syncViewerRelayStackNostrLandAggrEligible([])
})

describe('nostr.land aggr eligibility', () => {
  it('enables aggr only when wss://nostr.land is on favorites or relay lists', () => {
    expect(relayUrlsIncludeCanonicalNostrLandRelay(['wss://nostr.land/'])).toBe(true)
    expect(relayUrlsIncludeCanonicalNostrLandRelay(['wss://aggr.nostr.land/'])).toBe(false)
    expect(relayUrlsIncludeCanonicalNostrLandRelay(['wss://hist.nostr.land/'])).toBe(false)

    syncViewerRelayStackNostrLandAggrEligible(['wss://nostr.land/'])
    expect(getViewerNostrLandAggrSearchRelayUrls()[0]).toMatch(/^wss:\/\/aggr\.nostr\.land\/?$/)
    expect(prependAggrNostrLandIfViewerEligible(['wss://inbox.example/'])[0]).toMatch(
      /^wss:\/\/aggr\.nostr\.land\/?$/
    )

    syncViewerRelayStackNostrLandAggrEligible(['wss://relay.example/'])
    expect(getViewerNostrLandAggrSearchRelayUrls()).toEqual([])
    expect(prependAggrNostrLandIfViewerEligible(['wss://inbox.example/'])).toEqual([
      'wss://inbox.example/'
    ])
  })

  it('prependAggrForEventLookupRelayUrls matches prependAggrNostrLandIfViewerEligible', () => {
    syncViewerRelayStackNostrLandAggrEligible(['wss://nostr.land/'])
    expect(prependAggrForEventLookupRelayUrls(['wss://inbox.example/'])[0]).toMatch(
      /^wss:\/\/aggr\.nostr\.land\/?$/
    )
  })

  it('getAggrAwareSearchRelayUrls prepends aggr when eligible', () => {
    syncViewerRelayStackNostrLandAggrEligible(['wss://nostr.land/'])
    const urls = getAggrAwareSearchRelayUrls()
    expect(urls[0]).toMatch(/^wss:\/\/aggr\.nostr\.land\/?$/)
    expect(urls.length).toBeGreaterThan(1)

    syncViewerRelayStackNostrLandAggrEligible([])
    expect(getAggrAwareSearchRelayUrls().some((u) => /aggr\.nostr\.land/i.test(u))).toBe(false)
  })

  it('strips aggr from fetch stacks when viewer does not list nostr.land', () => {
    syncViewerRelayStackNostrLandAggrEligible([])
    expect(
      filterAggrNostrLandUnlessViewerEligible([
        'wss://relay.example/',
        AGGR_NOSTR_LAND_WSS
      ])
    ).toEqual(['wss://relay.example/'])
  })
})
