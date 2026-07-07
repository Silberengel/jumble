import { describe, expect, it } from 'vitest'
import {
  eventSeenOnMatchesAllowlist,
  filterRelaysToUserAllowlist,
  isRelayInUserAllowlist
} from '@/lib/relay-allowlist'

describe('relay-allowlist', () => {
  const allow = ['wss://theforest.nostr1.com/', 'wss://feeds.nostrarchives.com/notes/trending/reactions/today']

  it('matches hostname across schemes', () => {
    expect(isRelayInUserAllowlist('wss://theforest.nostr1.com/', allow)).toBe(true)
    expect(isRelayInUserAllowlist('https://theforest.nostr1.com/', allow)).toBe(true)
    expect(isRelayInUserAllowlist('wss://nostr.wine/', allow)).toBe(false)
  })

  it('filters relay lists to the allowlist', () => {
    expect(
      filterRelaysToUserAllowlist(
        ['wss://nostr.wine/', 'wss://theforest.nostr1.com/', 'wss://theforest.nostr1.com/'],
        allow
      )
    ).toEqual(['wss://theforest.nostr1.com/'])
  })

  it('eventSeenOnMatchesAllowlist allows empty seen-on and blocks unknown relays', () => {
    expect(eventSeenOnMatchesAllowlist([], allow)).toBe(true)
    expect(eventSeenOnMatchesAllowlist(['wss://theforest.nostr1.com/'], allow)).toBe(true)
    expect(eventSeenOnMatchesAllowlist(['wss://nostr.wine/'], allow)).toBe(false)
    expect(
      eventSeenOnMatchesAllowlist(['wss://nostr.wine/', 'wss://theforest.nostr1.com/'], allow)
    ).toBe(true)
  })

  it('strictUnknownSeenOn hides rows with no delivery relay', () => {
    expect(eventSeenOnMatchesAllowlist([], allow, { strictUnknownSeenOn: true })).toBe(false)
    expect(
      eventSeenOnMatchesAllowlist(['wss://theforest.nostr1.com/'], allow, {
        strictUnknownSeenOn: true
      })
    ).toBe(true)
  })
})
