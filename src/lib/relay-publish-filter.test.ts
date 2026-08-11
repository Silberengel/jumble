import { kinds } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import {
  filterContextAuthorReadRelaysForPublish,
  filterRelaysForEventPublish,
  isReadOnlyRelayUrl,
  isRelayPublishPolicyRejection,
  relayAllowsPublishKind
} from './relay-publish-filter'

describe('relay-publish-filter', () => {
  it('blocks profile/index mirrors for kind 1 and 7', () => {
    expect(relayAllowsPublishKind('wss://profiles.nostr1.com/', kinds.ShortTextNote)).toBe(false)
    expect(relayAllowsPublishKind('wss://purplepag.es/', kinds.Reaction)).toBe(false)
    expect(relayAllowsPublishKind('wss://indexer.coracle.social/', kinds.ShortTextNote)).toBe(false)
  })

  it('allows profile/index mirrors for kind 0 and 10002', () => {
    expect(relayAllowsPublishKind('wss://profiles.nostrver.se/', kinds.Metadata)).toBe(true)
    expect(relayAllowsPublishKind('wss://indexer.coracle.social/', kinds.RelayList)).toBe(true)
  })

  it('strips read-only aggregators and profile mirrors from publish lists', () => {
    const out = filterRelaysForEventPublish(
      [
        'wss://nostr.land/',
        'wss://profiles.nostr1.com/',
        'wss://relay.primal.net/',
        'wss://aggr.nostr.land/'
      ],
      kinds.ShortTextNote
    )
    // wss://nostr.land is a writable inbox relay (only wss://aggr.nostr.land is the read-only aggregator).
    expect(out).toEqual(['wss://nostr.land/', 'wss://relay.primal.net/'])
  })

  it('strips filter.nostr.wine broadcast paths (hostname match on READ_ONLY_RELAY_URLS)', () => {
    const broadcast =
      'wss://filter.nostr.wine/npub13epj452d892app3mjath3uxgs9l03rylzxwkymdp50avukztmfeschauwt?broadcast=true'
    expect(isReadOnlyRelayUrl(broadcast)).toBe(true)
    const out = filterRelaysForEventPublish(
      ['wss://relay.damus.io/', broadcast],
      kinds.Reaction
    )
    expect(out).toEqual(['wss://relay.damus.io/'])
  })

  it('keeps mercury HTTPS index API publishable while its WS endpoint stays read-only', () => {
    expect(isReadOnlyRelayUrl('wss://mercury-relay.imwald.eu/relay')).toBe(true)
    expect(isReadOnlyRelayUrl('https://mercury-relay.imwald.eu/')).toBe(false)
    const out = filterRelaysForEventPublish(
      ['https://mercury-relay.imwald.eu/', 'wss://mercury-relay.imwald.eu/relay'],
      kinds.ShortTextNote
    )
    expect(out.some((u) => u.startsWith('https://mercury-relay.imwald.eu'))).toBe(true)
    expect(out.some((u) => u.startsWith('wss://mercury-relay.imwald.eu'))).toBe(false)
  })

  it('strips profile mirrors from author read hints', () => {
    const out = filterContextAuthorReadRelaysForPublish([
      'wss://profiles.nostrver.se/',
      'wss://relay.example.com/'
    ])
    expect(out).toEqual(['wss://relay.example.com/'])
  })

  it('detects relay kind-policy rejections (not infrastructure faults)', () => {
    expect(
      isRelayPublishPolicyRejection(
        'only published longform articles accepted on this relay (kind 30023)'
      )
    ).toBe(true)
    expect(isRelayPublishPolicyRejection('this relay only accepts kind 1')).toBe(true)
    expect(isRelayPublishPolicyRejection('Remote relay connection timeout')).toBe(false)
    expect(isRelayPublishPolicyRejection('Publish timeout after 8000ms')).toBe(false)
  })
})
