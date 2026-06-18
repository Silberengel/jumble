import { describe, expect, it } from 'vitest'
import { looksLikeRelayUrlInput, normalizeAnyRelayUrl, normalizeHttpUrl } from '@/lib/url'

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

describe('normalizeAnyRelayUrl relay hostname aliases', () => {
  it('rewrites nostr.sovbit.host to relay.sovbit.host', () => {
    expect(normalizeAnyRelayUrl('wss://nostr.sovbit.host/')).toBe('wss://relay.sovbit.host/')
  })

  it('strips trailing dot from hostname', () => {
    expect(normalizeAnyRelayUrl('wss://relay.example.com./')).toBe('wss://relay.example.com/')
    expect(normalizeHttpUrl('https://mercury-relay.imwald.eu./')).toBe('https://mercury-relay.imwald.eu')
  })
})

describe('normalizeHttpUrl', () => {
  it('auto-prefixes bare website hosts with https', () => {
    expect(normalizeHttpUrl('www.example.com')).toBe('https://www.example.com')
    expect(normalizeHttpUrl('btcmap.org')).toBe('https://btcmap.org')
  })

  it('memoizes repeated normalization', () => {
    expect(normalizeHttpUrl('https://memo.test')).toBe('https://memo.test')
    expect(normalizeHttpUrl('https://memo.test')).toBe('https://memo.test')
  })

  it('rejects non-url bare strings', () => {
    expect(normalizeHttpUrl('Nusa')).toBe('')
  })
})
