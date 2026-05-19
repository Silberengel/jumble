import { describe, expect, it } from 'vitest'
import { buildProfileReportsRelayUrls } from './profile-reports-relays'

describe('buildProfileReportsRelayUrls', () => {
  it('uses inbox, http-index, and cache layers only', () => {
    const urls = buildProfileReportsRelayUrls(
      {
        read: ['wss://inbox.example.com/'],
        httpRead: ['https://index.example.com/'],
        write: ['wss://outbox.example.com/']
      },
      [],
      {
        includeAuthorLocalRelays: true,
        cacheRelayUrls: ['ws://127.0.0.1:4869/']
      }
    )
    expect(urls.some((u) => u.includes('inbox.example.com'))).toBe(true)
    expect(urls.some((u) => u.includes('index.example.com'))).toBe(true)
    expect(urls.some((u) => u.includes('127.0.0.1'))).toBe(true)
    expect(urls.some((u) => u.includes('outbox.example.com'))).toBe(false)
    expect(urls.some((u) => u.includes('damus'))).toBe(false)
  })
})
