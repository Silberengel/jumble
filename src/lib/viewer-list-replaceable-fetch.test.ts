import { ExtendedKind } from '@/constants'
import { dedupeWriteOutboxUrls, pickNewestListEvent } from '@/lib/viewer-list-replaceable-fetch'
import { kinds } from 'nostr-tools'
import { describe, expect, it } from 'vitest'

describe('pickNewestListEvent', () => {
  const older = {
    id: 'a',
    pubkey: 'b'.repeat(64),
    created_at: 1,
    kind: ExtendedKind.FAVORITE_RELAYS,
    tags: [],
    content: '',
    sig: 'c'.repeat(128)
  }
  const newer = { ...older, id: 'd', created_at: 2 }

  it('prefers the newer event', () => {
    expect(pickNewestListEvent(older, newer)).toBe(newer)
    expect(pickNewestListEvent(newer, older)).toBe(newer)
  })
})

describe('dedupeWriteOutboxUrls', () => {
  it('dedupes and caps write outbox urls', () => {
    const urls = dedupeWriteOutboxUrls(
      [
        'wss://relay.example.com/',
        'wss://relay.example.com',
        'wss://other.example.com/'
      ],
      2
    )
    expect(urls).toHaveLength(2)
    expect(urls.some((u) => u.includes('relay.example.com'))).toBe(true)
    expect(urls.some((u) => u.includes('other.example.com'))).toBe(true)
  })
})

describe('VIEWER_LIST_REPLACEABLE_KINDS', () => {
  it('includes mailbox and list kinds', async () => {
    const mod = await import('@/lib/viewer-list-replaceable-fetch')
    expect(mod.VIEWER_LIST_REPLACEABLE_KINDS).toContain(kinds.RelayList)
    expect(mod.VIEWER_LIST_REPLACEABLE_KINDS).toContain(ExtendedKind.FAVORITE_RELAYS)
    expect(mod.VIEWER_LIST_REPLACEABLE_KINDS).toContain(ExtendedKind.BLOCKED_RELAYS)
    expect(mod.VIEWER_LIST_REPLACEABLE_KINDS).toContain(ExtendedKind.CACHE_RELAYS)
    expect(mod.VIEWER_LIST_REPLACEABLE_KINDS).toContain(ExtendedKind.HTTP_RELAY_LIST)
  })
})
