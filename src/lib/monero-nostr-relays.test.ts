import { describe, expect, it } from 'vitest'
import { appendMoneroNostrRelays, pinMoneroNostrRelaysInRelayCap } from './monero-nostr-relays'

describe('appendMoneroNostrRelays', () => {
  it('appends PMNR relays without duplicates', () => {
    const out = appendMoneroNostrRelays(['wss://nostr.xmr.rocks', 'wss://relay.damus.io'])
    expect(out[0]).toBe('wss://nostr.xmr.rocks')
    expect(out[1]).toBe('wss://relay.damus.io')
    expect(out.some((u) => u.includes('nosmero.com'))).toBe(true)
    expect(out.filter((u) => u.includes('nostr.xmr.rocks')).length).toBe(1)
    expect(new Set(out.map((u) => u.toLowerCase())).size).toBe(out.length)
  })
})

describe('pinMoneroNostrRelaysInRelayCap', () => {
  it('keeps nosmero relay even when cap is full', () => {
    const personal = Array.from({ length: 10 }, (_, i) => `wss://inbox-${i}.example/`)
    const out = pinMoneroNostrRelaysInRelayCap(personal, 10)
    expect(out.length).toBeLessThanOrEqual(10)
    expect(out.some((u) => u.includes('nosmero.com'))).toBe(true)
  })
})
