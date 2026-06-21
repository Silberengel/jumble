import { describe, expect, it } from 'vitest'
import { buildGeneralSearchRelayUrls } from '@/lib/general-search-relay-urls'
import { SEARCHABLE_RELAY_URLS } from '@/constants'

describe('buildGeneralSearchRelayUrls', () => {
  it('includes user relays and searchable index relays', () => {
    const urls = buildGeneralSearchRelayUrls({
      relayList: {
        read: ['wss://inbox.example'],
        write: ['wss://out.example'],
        httpRead: [],
        httpWrite: [],
        originalRelays: [],
        httpOriginalRelays: []
      },
      cacheRelayListEvent: undefined,
      favoriteRelays: ['wss://fav.example'],
      blockedRelays: []
    })
    expect(urls.some((u) => u.includes('inbox.example'))).toBe(true)
    expect(urls.some((u) => u.includes('out.example'))).toBe(true)
    expect(urls.some((u) => u.includes('fav.example'))).toBe(true)
    for (const s of SEARCHABLE_RELAY_URLS) {
      expect(urls.some((u) => u.includes(new URL(s).host))).toBe(true)
    }
  })

  it('drops blocked relays', () => {
    const urls = buildGeneralSearchRelayUrls({
      relayList: {
        read: ['wss://blocked.example'],
        write: [],
        httpRead: [],
        httpWrite: [],
        originalRelays: [],
        httpOriginalRelays: []
      },
      cacheRelayListEvent: undefined,
      favoriteRelays: [],
      blockedRelays: ['wss://blocked.example']
    })
    expect(urls).not.toContain('wss://blocked.example')
  })
})
