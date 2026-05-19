import { describe, expect, it } from 'vitest'
import {
  buildPersonalRelayKeySet,
  sanitizeRelayUrlsForFetch,
  setViewerPersonalRelayKeys
} from './read-only-relay-personal'
import { stripLocalRelaysFromThirdPartyHints } from './relay-list-sanitize'

describe('stripLocalRelaysFromThirdPartyHints', () => {
  it('removes loopback and LAN from hint lists', () => {
    const urls = [
      'wss://relay.example.com/',
      'ws://localhost:4869/',
      'wss://192.168.1.50:7777/',
      'wss://filter.nostr.wine/'
    ]
    expect(stripLocalRelaysFromThirdPartyHints(urls)).toEqual([
      'wss://relay.example.com/',
      'wss://filter.nostr.wine/'
    ])
  })
})

describe('sanitizeRelayUrlsForFetch', () => {
  it('strips third-party locals and unlisted filter.nostr.wine', () => {
    setViewerPersonalRelayKeys(new Set())
    const urls = ['wss://relay.example.com/', 'ws://127.0.0.1:7777/', 'wss://filter.nostr.wine/']
    expect(sanitizeRelayUrlsForFetch(urls)).toEqual(['wss://relay.example.com/'])
  })

  it('keeps viewer cache localhost when on personal keys', () => {
    const local = 'ws://127.0.0.1:4869/'
    setViewerPersonalRelayKeys(buildPersonalRelayKeySet([local]))
    const urls = ['wss://relay.example.com/', local, 'ws://192.168.0.2:7777/']
    expect(sanitizeRelayUrlsForFetch(urls)).toEqual(['wss://relay.example.com/', local])
  })
})
