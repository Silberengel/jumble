import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { AGGR_NOSTR_LAND_WSS } from '@/lib/nostr-land-aggr'
import { syncViewerRelayStackNostrLandAggrEligible } from '@/lib/nostr-land-relay-eligibility'
import {
  buildPersonalRelayKeySet,
  filterReadOnlyRelaysUnlessPersonal,
  grantRelayConnectionOperationScope,
  isPersonalListRequiredReadOnlyRelay,
  isRelayConnectionAllowedForViewer,
  resetRelayConnectionOperationScopeForTests,
  sanitizeRelayUrlsForFetch,
  enterSingleRelayExplicitBrowse,
  enterSingleRelayExplicitFetchScope,
  leaveSingleRelayExplicitBrowse,
  setViewerPersonalRelayKeys
} from './read-only-relay-personal'
import { setViewerBlockedRelayUrls } from './viewer-blocked-relays'

describe('read-only-relay-personal', () => {
  beforeEach(() => {
    setViewerPersonalRelayKeys(new Set(), { viewerActive: false })
    setViewerBlockedRelayUrls([])
    syncViewerRelayStackNostrLandAggrEligible([])
    resetRelayConnectionOperationScopeForTests()
  })

  afterEach(() => {
    leaveSingleRelayExplicitBrowse()
    setViewerPersonalRelayKeys(new Set(), { viewerActive: false })
    setViewerBlockedRelayUrls([])
    syncViewerRelayStackNostrLandAggrEligible([])
    resetRelayConnectionOperationScopeForTests()
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

  it('personal-relay policy blocks ad-hoc feed relays at connect time', () => {
    setViewerPersonalRelayKeys(buildPersonalRelayKeySet(['wss://relay.example.com/']), { viewerActive: true })
    const urls = [
      'wss://relay.example.com/',
      'wss://profiles.nostr1.com/',
      'wss://theforest.nostr1.com/',
      'wss://nostr.wirednet.jp/'
    ]
    expect(sanitizeRelayUrlsForFetch(urls)).toEqual([
      'wss://relay.example.com/',
      'wss://profiles.nostr1.com/'
    ])
    expect(isRelayConnectionAllowedForViewer('wss://profiles.nostr1.com/')).toBe(true)
    expect(isRelayConnectionAllowedForViewer('wss://thecitadel.nostr1.com/')).toBe(true)
    expect(isRelayConnectionAllowedForViewer('wss://relay.example.com/')).toBe(true)
    expect(isRelayConnectionAllowedForViewer('wss://theforest.nostr1.com/')).toBe(false)
    expect(isRelayConnectionAllowedForViewer('wss://nostr.wirednet.jp/')).toBe(false)
  })

  it('personal-relay policy still allows aggr when viewer lists wss://nostr.land', () => {
    syncViewerRelayStackNostrLandAggrEligible(['wss://nostr.land/'])
    setViewerPersonalRelayKeys(buildPersonalRelayKeySet(['wss://nostr.land/']), { viewerActive: true })
    const urls = ['wss://nostr.land/', AGGR_NOSTR_LAND_WSS, 'wss://nostr.wirednet.jp/']
    expect(sanitizeRelayUrlsForFetch(urls).map((u) => u.replace(/\/$/, ''))).toEqual([
      'wss://nostr.land',
      'wss://aggr.nostr.land'
    ])
    expect(isRelayConnectionAllowedForViewer(AGGR_NOSTR_LAND_WSS)).toBe(true)
    expect(isRelayConnectionAllowedForViewer('wss://nostr.wirednet.jp/')).toBe(false)
  })

  it('operation scope allows document and gif constant relays during fetch', () => {
    setViewerPersonalRelayKeys(new Set(), { viewerActive: true })
    expect(isRelayConnectionAllowedForViewer('wss://theforest.nostr1.com/')).toBe(false)
    expect(isRelayConnectionAllowedForViewer('wss://nostr.wirednet.jp/')).toBe(false)
    const revoke = grantRelayConnectionOperationScope([
      'wss://thecitadel.nostr1.com/',
      'wss://nostr.wirednet.jp/',
      'wss://essayist.decentnewsroom.com/'
    ])
    expect(isRelayConnectionAllowedForViewer('wss://thecitadel.nostr1.com/')).toBe(true)
    expect(isRelayConnectionAllowedForViewer('wss://nostr.wirednet.jp/')).toBe(false)
    expect(isRelayConnectionAllowedForViewer('wss://essayist.decentnewsroom.com/')).toBe(true)
    revoke()
  })

  it('personal-relay policy allows document relays only during an operation scope', () => {
    setViewerPersonalRelayKeys(new Set(), { viewerActive: true })
    expect(isRelayConnectionAllowedForViewer('wss://essayist.decentnewsroom.com/')).toBe(false)
    const revoke = grantRelayConnectionOperationScope(['wss://essayist.decentnewsroom.com/'])
    expect(isRelayConnectionAllowedForViewer('wss://essayist.decentnewsroom.com/')).toBe(true)
    revoke()
    expect(isRelayConnectionAllowedForViewer('wss://essayist.decentnewsroom.com/')).toBe(false)
  })

  it('personal-relay policy allows viewer cache and HTTP index relays', () => {
    setViewerPersonalRelayKeys(
      buildPersonalRelayKeySet([
        'ws://localhost:4869/',
        'https://index.example.com/',
        'wss://nostr.land/'
      ]),
      { viewerActive: true }
    )
    expect(isRelayConnectionAllowedForViewer('ws://localhost:4869/')).toBe(true)
    expect(isRelayConnectionAllowedForViewer('https://index.example.com/')).toBe(true)
    expect(isRelayConnectionAllowedForViewer('wss://theforest.nostr1.com/')).toBe(false)
  })

  it('personal-relay policy allows profile index relays without operation scope', () => {
    setViewerPersonalRelayKeys(new Set(), { viewerActive: true })
    expect(isRelayConnectionAllowedForViewer('wss://profiles.nostr1.com/')).toBe(true)
    expect(sanitizeRelayUrlsForFetch(['wss://profiles.nostr1.com/', 'wss://nostr.wirednet.jp/'])).toEqual([
      'wss://profiles.nostr1.com/'
    ])
  })

  it('explicit single-relay browse keeps user-blocked and non-list relays', () => {
    setViewerPersonalRelayKeys(buildPersonalRelayKeySet(['wss://nostr.land/']), { viewerActive: true })
    setViewerBlockedRelayUrls(['wss://relay.layer.systems/'])
    enterSingleRelayExplicitBrowse()
    const target = 'wss://relay.layer.systems/'
    expect(sanitizeRelayUrlsForFetch([target])).toEqual([target])
    expect(isRelayConnectionAllowedForViewer(target)).toBe(true)
    leaveSingleRelayExplicitBrowse()
  })

  it('operation scope grants an explicit single-relay target under personal-relay policy', () => {
    setViewerPersonalRelayKeys(new Set(), { viewerActive: true })
    const leaveFetchScope = enterSingleRelayExplicitFetchScope()
    const target = 'wss://relay.layer.systems/'
    const revokeScope = grantRelayConnectionOperationScope([target])
    expect(isRelayConnectionAllowedForViewer(target)).toBe(true)
    revokeScope()
    leaveFetchScope()
  })
})
