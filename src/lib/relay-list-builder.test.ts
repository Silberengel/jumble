import { PROFILE_RELAY_URLS } from '@/constants'
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
    const urls = buildAccountSessionNetworkHydrateRelayUrls({ relayListEvent })
    expect(urls).toContain('wss://relay.example.com/')
    expect(urls.some((u) => PROFILE_RELAY_URLS.includes(u))).toBe(true)
    expect(urls.some((u) => u.includes('theforest.nostr1.com'))).toBe(false)
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
