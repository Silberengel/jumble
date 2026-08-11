import { describe, expect, it, vi } from 'vitest'
import {
  collectReadInboxUrlsFromRelayList,
  collectUserReadInboxUrls,
  collectRemoteReadInboxUrlsFromRelayList,
  collectViewerReadInboxUrls
} from '@/lib/viewer-read-inboxes'

vi.mock('@/lib/private-relays', () => ({
  getCacheRelayUrls: vi.fn(async () => ['ws://localhost:4869/'])
}))

describe('viewer read inboxes', () => {
  const relayList = {
    write: ['wss://outbox.example/'],
    read: ['wss://inbox.example/'],
    httpWrite: [],
    httpRead: ['https://http-in.example/'],
    originalRelays: [],
    httpOriginalRelays: []
  }

  it('collectReadInboxUrlsFromRelayList merges http before ws (no cache layer)', () => {
    expect(collectReadInboxUrlsFromRelayList(relayList)).toEqual([
      'https://http-in.example',
      'wss://inbox.example/'
    ])
  })

  it('collectUserReadInboxUrls orders cache before http before ws', () => {
    expect(collectUserReadInboxUrls(relayList, ['ws://127.0.0.1:4869'])).toEqual([
      'ws://127.0.0.1:4869/',
      'https://http-in.example',
      'wss://inbox.example/'
    ])
  })

  it('collectRemoteReadInboxUrlsFromRelayList drops LAN urls', () => {
    expect(
      collectRemoteReadInboxUrlsFromRelayList({
        ...relayList,
        read: ['wss://inbox.example/', 'ws://127.0.0.1:4869/']
      })
    ).toEqual(['https://http-in.example', 'wss://inbox.example/'])
  })

  it('collectViewerReadInboxUrls loads cache from kind 10432', async () => {
    await expect(collectViewerReadInboxUrls('ab'.repeat(32), relayList)).resolves.toEqual([
      'ws://localhost:4869/',
      'https://http-in.example',
      'wss://inbox.example/'
    ])
  })
})
