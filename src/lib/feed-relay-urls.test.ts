import { describe, expect, it } from 'vitest'
import { pinHttpIndexRelaysInRelayCap, pinViewerMailboxReadRelaysInRelayCap, uniqueRelayUrlsFromSubRequests } from '@/lib/feed-relay-urls'

describe('feed-relay-urls', () => {
  it('collects deduped relay URLs from subrequests', () => {
    expect(
      uniqueRelayUrlsFromSubRequests([
        { urls: ['wss://a.example/', 'wss://b.example/'], filter: { limit: 1 } },
        { urls: ['wss://a.example/', 'wss://c.example/'], filter: { limit: 1 } }
      ])
    ).toEqual(['wss://a.example/', 'wss://b.example/', 'wss://c.example/'])
  })

  it('pins kind-10243 HTTP read relays into a capped faux spell stack', () => {
    const ws = Array.from({ length: 10 }, (_, i) => `wss://relay-${i}.example/`)
    const http = 'https://index.example.com/'
    const capped = pinHttpIndexRelaysInRelayCap(ws, [...ws, http], 10)
    expect(capped.some((u) => u.includes('index.example.com'))).toBe(true)
    expect(capped.length).toBe(10)
  })

  it('pins kind-10432 cache relays into a capped stack', () => {
    const ws = Array.from({ length: 10 }, (_, i) => `wss://relay-${i}.example/`)
    const cache = 'ws://127.0.0.1:4869/'
    const capped = pinViewerMailboxReadRelaysInRelayCap(ws, [...ws, cache], 10)
    expect(capped.some((u) => u.includes('127.0.0.1:4869'))).toBe(true)
    expect(capped.length).toBe(10)
  })
})
