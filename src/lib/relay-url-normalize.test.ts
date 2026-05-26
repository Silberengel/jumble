import { describe, expect, it } from 'vitest'
import {
  canonicalRelaySessionKey,
  httpIndexBasesForRelayQuery,
  httpIndexRelayBasesInUrlBatch,
  normalizeAnyRelayUrl,
  normalizeHttpRelayUrl,
  normalizeRelayUrlByScheme,
  normalizeRelayUrlForPage,
  normalizeUrl
} from '@/lib/url'

describe('relay URL normalization', () => {
  it('does not treat arbitrary https URLs as WebSocket relays', () => {
    expect(normalizeAnyRelayUrl('https://mercury-relay.imwald.eu/')).toBe('')
    expect(normalizeUrl('https://mercury-relay.imwald.eu/')).toBe('')
    expect(normalizeHttpRelayUrl('https://mercury-relay.imwald.eu/')).toMatch(
      /^https:\/\/mercury-relay\.imwald\.eu\/?$/
    )
    expect(normalizeRelayUrlForPage('https://mercury-relay.imwald.eu/')).toMatch(
      /^https:\/\/mercury-relay\.imwald\.eu\/?$/
    )
  })

  it('keeps wss relays as wss', () => {
    const wss = normalizeAnyRelayUrl('wss://nostr.land/')
    expect(wss).toMatch(/^wss:\/\/nostr\.land\/?$/)
    expect(normalizeUrl('wss://nostr.land/')).toMatch(/^wss:\/\/nostr\.land\/?$/)
  })

  it('normalizeRelayUrlByScheme routes by scheme', () => {
    expect(normalizeRelayUrlByScheme('wss://nostr.land/')).toMatch(/^wss:\/\/nostr\.land\/?$/)
    expect(normalizeRelayUrlByScheme('https://mercury-relay.imwald.eu/')).toMatch(
      /^https:\/\/mercury-relay\.imwald\.eu\/?$/
    )
    expect(normalizeRelayUrlByScheme('mercury-relay.imwald.eu')).toBe('')
  })

  it('rejects bare hostnames', () => {
    expect(normalizeAnyRelayUrl('mercury-relay.imwald.eu')).toBe('')
    expect(normalizeAnyRelayUrl('nostr.land')).toBe('')
  })

  it('only treats configured kind 10243 bases as HTTP index in a URL batch', () => {
    const batch = [
      'wss://nostr.land/',
      'https://mercury-relay.imwald.eu/',
      'https://profile-website.example/'
    ]
    const configured = ['https://mercury-relay.imwald.eu/']
    expect(httpIndexRelayBasesInUrlBatch(batch, configured)).toEqual([
      'https://mercury-relay.imwald.eu/'
    ])
    expect(httpIndexRelayBasesInUrlBatch(batch, [])).toEqual([])
  })

  it('httpIndexBasesForRelayQuery polls explicit https relays without kind-10243 config', () => {
    const batch = ['https://mercury-relay.imwald.eu/']
    expect(httpIndexBasesForRelayQuery(batch, [])).toEqual(['https://mercury-relay.imwald.eu/'])
    expect(httpIndexBasesForRelayQuery(batch, ['https://other.example/'])).toEqual([
      'https://mercury-relay.imwald.eu/'
    ])
  })

  it('canonicalRelaySessionKey routes by scheme without cross-normalizing', () => {
    expect(canonicalRelaySessionKey('wss://nostr.land/')).toMatch(/^wss:\/\/nostr\.land/)
    expect(canonicalRelaySessionKey('https://mercury-relay.imwald.eu/')).toMatch(
      /^https:\/\/mercury-relay\.imwald\.eu/
    )
  })

  it('does not alias https session keys to wss', () => {
    const https = canonicalRelaySessionKey('https://mercury-relay.imwald.eu/')
    const wss = canonicalRelaySessionKey('wss://mercury-relay.imwald.eu/')
    expect(https).not.toBe(wss)
    expect(https.startsWith('https://mercury-relay.imwald.eu')).toBe(true)
    expect(wss.startsWith('wss://mercury-relay.imwald.eu')).toBe(true)
  })
})
