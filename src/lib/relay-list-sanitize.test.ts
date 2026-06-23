import { describe, expect, it } from 'vitest'
import {
  buildPersonalRelayKeySet,
  sanitizeRelayUrlsForFetch,
  setViewerPersonalRelayKeys
} from './read-only-relay-personal'
import { stripLocalRelaysFromThirdPartyHints, normalizeWssRelayHintUrl } from './relay-list-sanitize'

describe('normalizeWssRelayHintUrl', () => {
  it('accepts remote wss only', () => {
    expect(normalizeWssRelayHintUrl('wss://relay.mostr.pub')).toBe('wss://relay.mostr.pub/')
    expect(normalizeWssRelayHintUrl('wss://relay.example.com/')).toBe('wss://relay.example.com/')
  })

  it('rejects http, https, ws, and LAN', () => {
    expect(normalizeWssRelayHintUrl('https://index.example/')).toBeUndefined()
    expect(normalizeWssRelayHintUrl('http://127.0.0.1:8090/')).toBeUndefined()
    expect(normalizeWssRelayHintUrl('ws://relay.example.com/')).toBeUndefined()
    expect(normalizeWssRelayHintUrl('ws://localhost:4869/')).toBeUndefined()
    expect(normalizeWssRelayHintUrl('wss://127.0.0.1:7777/')).toBeUndefined()
  })
})

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
    setViewerPersonalRelayKeys(new Set(), { viewerActive: false })
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
