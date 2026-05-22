import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { AGGR_NOSTR_LAND_WSS } from '@/lib/nostr-land-aggr'
import { syncViewerRelayStackNostrLandAggrEligible } from '@/lib/nostr-land-relay-eligibility'
import {
  buildPersonalRelayKeySet,
  filterReadOnlyRelaysUnlessPersonal,
  isPersonalListRequiredReadOnlyRelay,
  sanitizeRelayUrlsForFetch,
  setViewerPersonalRelayKeys
} from './read-only-relay-personal'

describe('read-only-relay-personal', () => {
  beforeEach(() => {
    setViewerPersonalRelayKeys(new Set())
    syncViewerRelayStackNostrLandAggrEligible([])
  })

  afterEach(() => {
    syncViewerRelayStackNostrLandAggrEligible([])
  })

  it('requires personal list only for filter.nostr.wine', () => {
    expect(isPersonalListRequiredReadOnlyRelay('wss://filter.nostr.wine/')).toBe(true)
    expect(isPersonalListRequiredReadOnlyRelay('wss://relay.damus.io/')).toBe(false)
    expect(isPersonalListRequiredReadOnlyRelay(AGGR_NOSTR_LAND_WSS)).toBe(false)
    expect(isPersonalListRequiredReadOnlyRelay('wss://search.nos.today/')).toBe(false)
  })

  it('strips unlisted filter.nostr.wine but keeps search indexers; aggr only when nostr.land is listed', () => {
    const urls = [
      'wss://relay.damus.io/',
      'wss://filter.nostr.wine/',
      AGGR_NOSTR_LAND_WSS,
      'wss://search.nos.today/'
    ]
    expect(filterReadOnlyRelaysUnlessPersonal(urls)).toEqual([
      'wss://relay.damus.io/',
      AGGR_NOSTR_LAND_WSS,
      'wss://search.nos.today/'
    ])
    expect(sanitizeRelayUrlsForFetch(urls)).toEqual([
      'wss://relay.damus.io/',
      'wss://search.nos.today/'
    ])
    syncViewerRelayStackNostrLandAggrEligible(['wss://nostr.land/'])
    expect(sanitizeRelayUrlsForFetch(urls).map((u) => u.replace(/\/$/, ''))).toEqual([
      'wss://relay.damus.io',
      'wss://aggr.nostr.land',
      'wss://search.nos.today'
    ])
  })

  it('keeps filter.nostr.wine when on the viewer personal list', () => {
    setViewerPersonalRelayKeys(buildPersonalRelayKeySet(['wss://filter.nostr.wine/']))
    const urls = ['wss://relay.damus.io/', 'wss://filter.nostr.wine/']
    expect(filterReadOnlyRelaysUnlessPersonal(urls)).toEqual(urls)
  })
})
