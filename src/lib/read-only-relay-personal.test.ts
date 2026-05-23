import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { AGGR_NOSTR_LAND_WSS } from '@/lib/nostr-land-aggr'
import { syncViewerRelayStackNostrLandAggrEligible } from '@/lib/nostr-land-relay-eligibility'
import {
  buildPersonalRelayKeySet,
  filterReadOnlyRelaysUnlessPersonal,
  isPersonalListRequiredReadOnlyRelay,
  isRelayConnectionAllowedForViewer,
  sanitizeRelayUrlsForFetch,
  enterMetadataRelaysOnlyBypass,
  leaveMetadataRelaysOnlyBypass,
  setRestrictConnectionsToMetadataRelaysOnly,
  setViewerPersonalRelayKeys
} from './read-only-relay-personal'
import { setViewerBlockedRelayUrls } from './viewer-blocked-relays'

describe('read-only-relay-personal', () => {
  beforeEach(() => {
    setRestrictConnectionsToMetadataRelaysOnly(false)
    setViewerPersonalRelayKeys(new Set(), { viewerActive: false })
    setViewerBlockedRelayUrls([])
    syncViewerRelayStackNostrLandAggrEligible([])
  })

  afterEach(() => {
    setRestrictConnectionsToMetadataRelaysOnly(false)
    leaveMetadataRelaysOnlyBypass()
    setViewerBlockedRelayUrls([])
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

  it('sanitizeRelayUrlsForFetch drops user-blocked relays', () => {
    setViewerBlockedRelayUrls(['wss://freelay.sovbit.host/'])
    expect(
      sanitizeRelayUrlsForFetch(['wss://relay.damus.io/', 'wss://freelay.sovbit.host/'])
    ).toEqual(['wss://relay.damus.io/'])
  })

  it('keeps filter.nostr.wine when on the viewer personal list', () => {
    setViewerPersonalRelayKeys(buildPersonalRelayKeySet(['wss://filter.nostr.wine/']), { viewerActive: true })
    const urls = ['wss://relay.damus.io/', 'wss://filter.nostr.wine/']
    expect(filterReadOnlyRelaysUnlessPersonal(urls)).toEqual(urls)
  })

  it('metadata-only policy blocks ad-hoc reads at network level, not in sanitizeRelayUrlsForFetch', () => {
    setRestrictConnectionsToMetadataRelaysOnly(true)
    setViewerPersonalRelayKeys(buildPersonalRelayKeySet(['wss://relay.example.com/']), { viewerActive: true })
    const urls = [
      'wss://relay.example.com/',
      'wss://profiles.nostr1.com/',
      'wss://theforest.nostr1.com/',
      'wss://nostr.wirednet.jp/'
    ]
    expect(sanitizeRelayUrlsForFetch(urls)).toEqual(urls)
    expect(isRelayConnectionAllowedForViewer('wss://profiles.nostr1.com/')).toBe(true)
    expect(isRelayConnectionAllowedForViewer('wss://theforest.nostr1.com/')).toBe(false)
    expect(isRelayConnectionAllowedForViewer('wss://nostr.wirednet.jp/')).toBe(false)
  })

  it('metadata-only policy still allows aggr when viewer lists wss://nostr.land', () => {
    setRestrictConnectionsToMetadataRelaysOnly(true)
    syncViewerRelayStackNostrLandAggrEligible(['wss://nostr.land/'])
    setViewerPersonalRelayKeys(buildPersonalRelayKeySet(['wss://nostr.land/']), { viewerActive: true })
    const urls = ['wss://nostr.land/', AGGR_NOSTR_LAND_WSS, 'wss://nostr.wirednet.jp/']
    expect(sanitizeRelayUrlsForFetch(urls).map((u) => u.replace(/\/$/, ''))).toEqual([
      'wss://nostr.land',
      'wss://aggr.nostr.land',
      'wss://nostr.wirednet.jp'
    ])
    expect(isRelayConnectionAllowedForViewer(AGGR_NOSTR_LAND_WSS)).toBe(true)
    expect(isRelayConnectionAllowedForViewer('wss://nostr.wirednet.jp/')).toBe(false)
  })

  it('metadata-only bypass allows relays outside personal lists', () => {
    setRestrictConnectionsToMetadataRelaysOnly(true)
    setViewerPersonalRelayKeys(buildPersonalRelayKeySet(['wss://nostr.land/']), { viewerActive: true })
    enterMetadataRelaysOnlyBypass()
    const urls = ['wss://nostr.land/', 'wss://relay.damus.io/']
    expect(sanitizeRelayUrlsForFetch(urls)).toEqual(urls)
    expect(isRelayConnectionAllowedForViewer('wss://relay.damus.io/')).toBe(true)
    leaveMetadataRelaysOnlyBypass()
  })
})
