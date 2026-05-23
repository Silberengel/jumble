import { describe, expect, it } from 'vitest'
import { appendMoneroNostrRelays } from './monero-nostr-relays'

describe('appendMoneroNostrRelays', () => {
  it('appends PMNR relays without duplicates', () => {
    const out = appendMoneroNostrRelays(['wss://nostr.xmr.rocks', 'wss://relay.damus.io'])
    expect(out[0]).toBe('wss://nostr.xmr.rocks')
    expect(out[1]).toBe('wss://relay.damus.io')
    expect(out.filter((u) => u.includes('xmr')).length).toBeGreaterThan(1)
    expect(new Set(out.map((u) => u.toLowerCase())).size).toBe(out.length)
  })
})
