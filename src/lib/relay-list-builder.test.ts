import { DEFAULT_FAVORITE_RELAYS, ExtendedKind, PROFILE_RELAY_URLS } from '@/constants'
import { describe, expect, it } from 'vitest'
import {
  buildAccountSessionNetworkHydrateRelayUrls,
  buildReplyReadRelayList
} from '@/lib/relay-list-builder'
import { kinds } from 'nostr-tools'

describe('buildAccountSessionNetworkHydrateRelayUrls', () => {
  it('uses personal mailbox and profile index relays, not FAST_READ', () => {
    const relayListEvent = {
      id: 'a',
      pubkey: 'b'.repeat(64),
      created_at: 1,
      kind: kinds.RelayList,
      tags: [
        ['r', 'wss://relay.example.com/', 'read'],
        ['r', 'wss://relay.example.com/', 'write']
      ],
      content: '',
      sig: 'c'.repeat(128)
    }
    const favoriteRelaysEvent = {
      id: 'd',
      pubkey: 'b'.repeat(64),
      created_at: 1,
      kind: ExtendedKind.FAVORITE_RELAYS,
      tags: [['relay', 'wss://configured-favorite.example.com/']],
      content: '',
      sig: 'c'.repeat(128)
    }
    const urls = buildAccountSessionNetworkHydrateRelayUrls({ relayListEvent, favoriteRelaysEvent })
    expect(urls.some((u) => u.includes('relay.example.com'))).toBe(true)
    expect(urls.some((u) => PROFILE_RELAY_URLS.some((p) => u.includes(new URL(p).host)))).toBe(true)
    expect(urls.some((u) => u.includes('theforest.nostr1.com'))).toBe(false)
  })

  it('prioritizes write relays and default favorites when no favorite list exists', () => {
    const relayListEvent = {
      id: 'a',
      pubkey: 'b'.repeat(64),
      created_at: 1,
      kind: kinds.RelayList,
      tags: [
        ['r', 'wss://write-only.example.com/', 'write'],
        ['r', 'wss://read-only.example.com/', 'read']
      ],
      content: '',
      sig: 'c'.repeat(128)
    }
    const urls = buildAccountSessionNetworkHydrateRelayUrls({ relayListEvent })
    expect(urls[0]?.includes('write-only.example.com')).toBe(true)
    for (const url of DEFAULT_FAVORITE_RELAYS) {
      const host = new URL(url).host
      expect(urls.some((u) => u.includes(host))).toBe(true)
    }
  })
})

describe('buildReplyReadRelayList relayAuthoritative', () => {
  it('returns only thread hints and author/user layers without favorite bootstrap', async () => {
    const out = await buildReplyReadRelayList(
      undefined,
      undefined,
      [],
      ['wss://nostr.land/'],
      { relayAuthoritative: true }
    )
    expect(out).toEqual(['wss://nostr.land/'])
  })
})
