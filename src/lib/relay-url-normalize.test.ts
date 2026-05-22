import { describe, expect, it } from 'vitest'
import {
  canonicalRelaySessionKey,
  normalizeAnyRelayUrl,
  normalizeHttpRelayUrl,
  normalizeUrl
} from '@/lib/url'

describe('relay URL normalization', () => {
  it('keeps https index relays as https (no wss conversion)', () => {
    const https = normalizeAnyRelayUrl('https://mercury-relay.imwald.eu/')
    expect(https).toMatch(/^https:\/\/mercury-relay\.imwald\.eu\/?$/)
    expect(https.startsWith('wss://')).toBe(false)
    expect(normalizeHttpRelayUrl('https://mercury-relay.imwald.eu/')).toMatch(
      /^https:\/\/mercury-relay\.imwald\.eu\/?$/
    )
    expect(normalizeUrl('https://mercury-relay.imwald.eu/')).toBe('')
  })

  it('keeps wss relays as wss', () => {
    const wss = normalizeAnyRelayUrl('wss://nostr.land/')
    expect(wss).toMatch(/^wss:\/\/nostr\.land\/?$/)
    expect(normalizeUrl('wss://nostr.land/')).toMatch(/^wss:\/\/nostr\.land\/?$/)
  })

  it('rejects bare hostnames', () => {
    expect(normalizeAnyRelayUrl('mercury-relay.imwald.eu')).toBe('')
    expect(normalizeAnyRelayUrl('nostr.land')).toBe('')
  })

  it('does not alias https session keys to wss', () => {
    const https = canonicalRelaySessionKey('https://mercury-relay.imwald.eu/')
    const wss = canonicalRelaySessionKey('wss://mercury-relay.imwald.eu/')
    expect(https).not.toBe(wss)
    expect(https.startsWith('https://mercury-relay.imwald.eu')).toBe(true)
    expect(wss.startsWith('wss://mercury-relay.imwald.eu')).toBe(true)
  })
})
