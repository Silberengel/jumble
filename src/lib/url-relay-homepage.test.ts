import { describe, expect, it } from 'vitest'
import { deriveRelayHomepageUrl } from './url'

describe('deriveRelayHomepageUrl', () => {
  it('converts wss relay URL to https homepage', () => {
    expect(deriveRelayHomepageUrl('wss://theforest.nostr1.com/')).toBe('https://theforest.nostr1.com')
  })

  it('passes through https URLs', () => {
    expect(deriveRelayHomepageUrl('https://nosmero.com/nip78-relay')).toBe('https://nosmero.com/nip78-relay')
  })

  it('maps Mercury WebSocket /relay path to HTTPS origin (NIP-11 and HTTP API live at root)', () => {
    expect(deriveRelayHomepageUrl('wss://mercury-relay.imwald.eu/relay')).toBe('https://mercury-relay.imwald.eu')
    expect(deriveRelayHomepageUrl('https://mercury-relay.imwald.eu/relay')).toBe('https://mercury-relay.imwald.eu')
  })

  it('returns empty for invalid input', () => {
    expect(deriveRelayHomepageUrl('')).toBe('')
    expect(deriveRelayHomepageUrl('not-a-url')).toBe('')
  })
})
