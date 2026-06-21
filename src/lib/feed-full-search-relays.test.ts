import { describe, expect, it } from 'vitest'
import { buildNoteSearchRelayFallbackUrls } from '@/lib/feed-full-search-relays'
import { FAST_READ_RELAY_URLS, SEARCHABLE_RELAY_URLS } from '@/constants'

describe('buildNoteSearchRelayFallbackUrls', () => {
  it('layers tag hints, seen, searchable, and fast read relays', () => {
    const urls = buildNoteSearchRelayFallbackUrls({
      relayHints: ['wss://nos.lol'],
      seenRelayUrls: ['wss://seen.example'],
      blockedRelays: []
    })
    expect(urls[0]).toMatch(/nos\.lol/i)
    expect(urls.some((u) => u.includes('seen.example'))).toBe(true)
    for (const s of SEARCHABLE_RELAY_URLS) {
      expect(urls.some((u) => u.includes(new URL(s).host))).toBe(true)
    }
    for (const s of FAST_READ_RELAY_URLS) {
      expect(urls.some((u) => u.includes(new URL(s).host))).toBe(true)
    }
  })

  it('drops blocked relays', () => {
    const urls = buildNoteSearchRelayFallbackUrls({
      relayHints: ['wss://blocked.example'],
      blockedRelays: ['wss://blocked.example']
    })
    expect(urls).not.toContain('wss://blocked.example')
  })
})
