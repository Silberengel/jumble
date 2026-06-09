import { describe, expect, it } from 'vitest'
import { deriveRelayHomepageUrl } from './url'

describe('deriveRelayHomepageUrl', () => {
  it('converts wss relay URL to https homepage', () => {
    expect(deriveRelayHomepageUrl('wss://theforest.nostr1.com/')).toBe('https://theforest.nostr1.com/')
  })

  it('passes through https URLs', () => {
    expect(deriveRelayHomepageUrl('https://nosmero.com/nip78-relay')).toBe('https://nosmero.com/nip78-relay')
  })

  it('returns empty for invalid input', () => {
    expect(deriveRelayHomepageUrl('')).toBe('')
    expect(deriveRelayHomepageUrl('not-a-url')).toBe('')
  })
})
