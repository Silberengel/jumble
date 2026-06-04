import { NOSTR_ARCHIVES_SEARCH_RELAY_URL } from '@/constants'
import { describe, expect, it } from 'vitest'
import {
  getRelayIconFallbackGlyph,
  getRelayIconLucideFallback,
  getRelayIconOverrideSrc,
  isLoopbackRelayUrl,
  NOSTRARCHIVES_SITE_ICON_SRC
} from '@/lib/relay-icon-source'

describe('relay icon branding', () => {
  it('uses favicon override for sovbit hosts', () => {
    expect(getRelayIconOverrideSrc('wss://nostr.sovbit.host/')).toContain('nostr.sovbit.host')
    expect(getRelayIconOverrideSrc('wss://freelay.sovbit.host/')).toContain('freelay.sovbit.host')
  })

  it('uses purple circle fallback glyph for purplepag.es', () => {
    expect(getRelayIconFallbackGlyph('wss://purplepag.es/')).toBe('🟣')
    expect(getRelayIconOverrideSrc('wss://purplepag.es/')).toBeUndefined()
  })

  it('uses nostrarchives favicon for search relay (same as trending)', () => {
    expect(getRelayIconOverrideSrc(NOSTR_ARCHIVES_SEARCH_RELAY_URL)).toBe(NOSTRARCHIVES_SITE_ICON_SRC)
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
