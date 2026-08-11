import { describe, expect, it, vi } from 'vitest'
import {
  collectUserWriteOutboxUrls,
  collectViewerWriteOutboxUrls,
  collectWriteOutboxUrlsFromRelayList
} from '@/lib/viewer-write-outboxes'

vi.mock('@/lib/private-relays', () => ({
  getCacheRelayUrls: vi.fn(async () => ['ws://localhost:4869/'])
}))

describe('viewer write outboxes', () => {
  const relayList = {
    write: ['wss://nip65.example/'],
    read: ['wss://inbox.example/'],
    httpWrite: ['https://http-out.example/'],
    httpRead: [],
    originalRelays: [],
    httpOriginalRelays: []
  }

  it('collectWriteOutboxUrlsFromRelayList merges http before ws (no cache layer)', () => {
    expect(collectWriteOutboxUrlsFromRelayList(relayList)).toEqual([
      'https://http-out.example',
      'wss://nip65.example/'
    ])
  })

  it('collectUserWriteOutboxUrls orders cache before http before ws', () => {
    expect(collectUserWriteOutboxUrls(relayList, ['ws://127.0.0.1:4869'])).toEqual([
      'ws://127.0.0.1:4869/',
      'https://http-out.example',
      'wss://nip65.example/'
    ])
  })

  it('collectViewerWriteOutboxUrls loads cache from kind 10432', async () => {
    await expect(collectViewerWriteOutboxUrls('ab'.repeat(32), relayList)).resolves.toEqual([
      'ws://localhost:4869/',
      'https://http-out.example',
      'wss://nip65.example/'
    ])
  })
})
