import { NOSTR_ARCHIVES_SEARCH_RELAY_URL } from '@/constants'
import { describe, expect, it } from 'vitest'
import {
  getRelayIconFallbackGlyph,
  getRelayIconOverrideSrc,
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
})
