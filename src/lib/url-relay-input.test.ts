import { describe, expect, it } from 'vitest'
import { looksLikeRelayUrlInput } from '@/lib/url'

describe('looksLikeRelayUrlInput', () => {
  it('rejects profile names and partial username typing', () => {
    for (const name of ['N', 'Nu', 'Nus', 'Nusa', 'alice', '@bob']) {
      expect(looksLikeRelayUrlInput(name)).toBe(false)
    }
  })

  it('accepts relay URL shapes', () => {
    expect(looksLikeRelayUrlInput('wss://relay.example.com/')).toBe(true)
    expect(looksLikeRelayUrlInput('ws://localhost:4869/')).toBe(true)
    expect(looksLikeRelayUrlInput('https://index.example.com/')).toBe(true)
    expect(looksLikeRelayUrlInput('relay.nostr1.com')).toBe(true)
    expect(looksLikeRelayUrlInput('nostr.wine')).toBe(true)
  })

  it('rejects bech32 identifiers', () => {
    expect(
      looksLikeRelayUrlInput('npub1uq6dv4yq94704gk5r22jsqg9gy2wpxkk5dft9q5gugc8tj53nq2qg5q22d')
    ).toBe(false)
  })
})
