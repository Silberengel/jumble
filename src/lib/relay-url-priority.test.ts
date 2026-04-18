import { describe, expect, it } from 'vitest'
import { dedupeNormalizeRelayUrlsOrdered, filterContextAuthorReadRelaysForPublish } from '@/lib/relay-url-priority'

describe('filterContextAuthorReadRelaysForPublish', () => {
  it('drops loopback, LAN, and .onion; keeps public relays', () => {
    const out = filterContextAuthorReadRelaysForPublish([
      'ws://localhost:4869/',
      'wss://127.0.0.1/',
      'wss://192.168.0.5/',
      'wss://abcdefghijklmnop.onion/',
      'wss://relay.example.com/'
    ])
    expect(out).toEqual(['wss://relay.example.com/'])
  })

  it('dedupes like dedupeNormalizeRelayUrlsOrdered', () => {
    const a = dedupeNormalizeRelayUrlsOrdered(['wss://relay.example.com/', 'wss://relay.example.com/'])
    const b = filterContextAuthorReadRelaysForPublish([
      'wss://relay.example.com/',
      'wss://relay.example.com/',
      'ws://localhost:4869/'
    ])
    expect(b).toEqual(a)
  })
})
