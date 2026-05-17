import { describe, expect, it } from 'vitest'
import { getNostrArchivesProfileUrl, getNostrWatchRelayUrl } from './link'

describe('getNostrWatchRelayUrl', () => {
  it('maps wss relay URL to nostr.watch path', () => {
    expect(getNostrWatchRelayUrl('wss://relay.noswhere.com')).toBe(
      'https://nostr.watch/relays/wss/relay.noswhere.com'
    )
  })
})

describe('getNostrArchivesProfileUrl', () => {
  it('maps hex pubkey to profile URL', () => {
    const hex = '63fe6318dc58583cfe16810f86dd09e18bfd76aabc24a0081ce2856f330504ed'
    expect(getNostrArchivesProfileUrl(hex)).toBe(`https://nostrarchives.com/profiles/${hex}`)
  })

  it('returns null for invalid pubkey', () => {
    expect(getNostrArchivesProfileUrl('not-a-pubkey')).toBeNull()
  })
})
