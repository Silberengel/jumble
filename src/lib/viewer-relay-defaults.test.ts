import { describe, expect, it } from 'vitest'
import { FAST_READ_RELAY_URLS, FAST_WRITE_RELAY_URLS } from '@/constants'
import {
  relayListHasUsableMailboxUrls,
  remoteAuthorMissingRelayListFallback,
  viewerMissingRelayListFallback,
  viewerUsesGlobalRelayDefaults
} from './viewer-relay-defaults'

describe('viewer-relay-defaults', () => {
  it('treats profile-index-only lists as unusable mailboxes', () => {
    expect(
      relayListHasUsableMailboxUrls({
        read: ['wss://profiles.nostr1.com/', 'wss://indexer.oracle.social/'],
        write: ['wss://purplepag.es/'],
        httpRead: []
      })
    ).toBe(false)
    expect(
      relayListHasUsableMailboxUrls({
        read: ['wss://profiles.nostr1.com/', 'wss://nostr.land/'],
        write: [],
        httpRead: []
      })
    ).toBe(true)
  })

  it('enables global defaults when mailbox is profile-index-only', () => {
    expect(
      viewerUsesGlobalRelayDefaults({
        viewerPubkey: 'ab'.repeat(32),
        favoriteRelayUrls: [],
        relayList: {
          read: ['wss://purplepag.es/'],
          write: ['wss://profiles.nostr1.com/'],
          httpRead: []
        }
      })
    ).toBe(true)
  })

  it('seeds viewer fallback from FAST_READ / FAST_WRITE', () => {
    const fb = viewerMissingRelayListFallback()
    expect(fb.read).toEqual([...FAST_READ_RELAY_URLS])
    expect(fb.write).toEqual([...FAST_WRITE_RELAY_URLS])
    expect(fb.originalRelays.length).toBeGreaterThan(0)
    expect(fb.originalRelays.every((r) => !r.url.includes('purplepag'))).toBe(true)
  })

  it('keeps remote missing-list originalRelays empty', () => {
    const fb = remoteAuthorMissingRelayListFallback()
    expect(fb.originalRelays).toEqual([])
    expect(fb.read).toEqual([...FAST_READ_RELAY_URLS])
    expect(fb.write).toEqual([...FAST_WRITE_RELAY_URLS])
  })
})
