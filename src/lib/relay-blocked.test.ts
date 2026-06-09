import { describe, expect, it } from 'vitest'
import { isRelayBlockedByUser } from './relay-blocked'

describe('isRelayBlockedByUser', () => {
  it('matches hostname across schemes', () => {
    expect(
      isRelayBlockedByUser('https://freelay.sovbit.host/', ['wss://freelay.sovbit.host/'])
    ).toBe(true)
  })

  it('treats nostr.sovbit.host and relay.sovbit.host as the same paid relay', () => {
    const blocked = ['wss://nostr.sovbit.host/']
    expect(isRelayBlockedByUser('wss://relay.sovbit.host/', blocked)).toBe(true)
    expect(isRelayBlockedByUser('wss://nostr.sovbit.host/', blocked)).toBe(true)
  })

  it('does not alias freelay with paid sovbit hosts', () => {
    const blocked = ['wss://nostr.sovbit.host/']
    expect(isRelayBlockedByUser('wss://freelay.sovbit.host/', blocked)).toBe(false)
  })
})
