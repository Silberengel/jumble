import { MONERO_NOSTR_RELAY_URLS, NOSTR_ARCHIVES_SEARCH_RELAY_URL } from '@/constants'
import { describe, expect, it } from 'vitest'
import {
  getDomainIconOverrideSrc,
  getRelayIconFallbackGlyph,
  getRelayIconLucideFallback,
  getRelayIconOverrideSrc,
  isLoopbackRelayUrl,
  NEROST_RELAY_ICON_SRC,
  NOSTR_LAND_ICON_SRC,
  NOSTRARCHIVES_SITE_ICON_SRC
} from '@/lib/relay-icon-source'

describe('relay icon branding', () => {
  it('uses sovbit.host favicon override for sovbit relay hosts', () => {
    expect(getRelayIconOverrideSrc('wss://relay.sovbit.host/')).toBe(
      'https://sovbit.host/images/favicon.ico'
    )
    expect(getRelayIconOverrideSrc('wss://freelay.sovbit.host/')).toBe(
      'https://sovbit.host/images/favicon.ico'
    )
    expect(getRelayIconOverrideSrc('wss://nostr.sovbit.host/')).toBe(
      'https://sovbit.host/images/favicon.ico'
    )
  })

  it('uses purple circle fallback glyph for purplepag.es', () => {
    expect(getRelayIconFallbackGlyph('wss://purplepag.es/')).toBe('🟣')
    expect(getRelayIconOverrideSrc('wss://purplepag.es/')).toBeUndefined()
  })

  it('uses nostrarchives favicon for search relay (same as trending)', () => {
    expect(getRelayIconOverrideSrc(NOSTR_ARCHIVES_SEARCH_RELAY_URL)).toBe(NOSTRARCHIVES_SITE_ICON_SRC)
  })

  it('uses nerostr.webp for PMNR / Nosmero monero relays', () => {
    for (const relayUrl of MONERO_NOSTR_RELAY_URLS) {
      expect(getRelayIconOverrideSrc(relayUrl)).toBe(NEROST_RELAY_ICON_SRC)
    }
  })

  it('uses nostr.land NIP-11 icon for relay and NIP-05 domain', () => {
    expect(getRelayIconOverrideSrc('wss://nostr.land/')).toBe(NOSTR_LAND_ICON_SRC)
    expect(getDomainIconOverrideSrc('nostr.land')).toBe(NOSTR_LAND_ICON_SRC)
  })

  it('uses branded icon overrides for associated NIP-05 domains', () => {
    expect(getDomainIconOverrideSrc('sovbit.host')).toBe('https://sovbit.host/images/favicon.ico')
    expect(getDomainIconOverrideSrc('xmr.rocks')).toBe(NEROST_RELAY_ICON_SRC)
    expect(getDomainIconOverrideSrc('nostr.xmr.rocks')).toBe(NEROST_RELAY_ICON_SRC)
    expect(getDomainIconOverrideSrc('nosmero.com')).toBe(NEROST_RELAY_ICON_SRC)
    expect(getDomainIconOverrideSrc('nostrarchives.com')).toBe(NOSTRARCHIVES_SITE_ICON_SRC)
    expect(getDomainIconOverrideSrc('example.com')).toBeUndefined()
  })

  it('uses search lucide fallback for search.nos.today', () => {
    expect(getRelayIconLucideFallback('wss://search.nos.today/')).toBe('search')
    expect(getRelayIconFallbackGlyph('wss://search.nos.today/')).toBeUndefined()
  })

  it('uses home lucide fallback for loopback relays', () => {
    expect(isLoopbackRelayUrl('ws://localhost:4869/')).toBe(true)
    expect(isLoopbackRelayUrl('ws://127.0.0.1:4869/')).toBe(true)
    expect(getRelayIconLucideFallback('ws://localhost:4869/')).toBe('home')
    expect(getRelayIconLucideFallback('ws://127.0.0.1:4869/')).toBe('home')
    expect(isLoopbackRelayUrl('wss://192.168.0.5/')).toBe(false)
    expect(getRelayIconLucideFallback('wss://192.168.0.5/')).toBeUndefined()
  })
})
