import { ExtendedKind } from '@/constants'
import {
  collapseStaleAddressableRevisions,
  compareReplaceableRevision,
  dedupeLatestAddressableEvents,
  getAddressableDedupeKey,
  pickNewestReplaceableRevision,
  upsertEventMapPreferNewestAddressable
} from '@/lib/replaceable-revision'
import { describe, expect, it } from 'vitest'
import type { Event } from 'nostr-tools'

function fakeEvent(partial: Partial<Event> & Pick<Event, 'kind' | 'tags'>): Event {
  return {
    id: partial.id ?? 'a'.repeat(64),
    pubkey: partial.pubkey ?? 'b'.repeat(64),
    content: partial.content ?? '',
    created_at: partial.created_at ?? 1,
    sig: 'sig',
    ...partial
  }
}

describe('replaceable revision helpers', () => {
  it('builds addressable dedupe keys from d tags', () => {
    const ev = fakeEvent({
      kind: ExtendedKind.WEB_BOOKMARK,
      tags: [['d', 'example.com/path']]
    })
    expect(getAddressableDedupeKey(ev)).toBe(`${ev.pubkey}:${ExtendedKind.WEB_BOOKMARK}:example.com/path`)
  })

  it('picks the newest revision by created_at then id', () => {
    const older = fakeEvent({
      id: '1'.repeat(64),
      kind: ExtendedKind.WEB_BOOKMARK,
      created_at: 10,
      tags: [['d', 'example.com']]
    })
    const newer = fakeEvent({
      id: '2'.repeat(64),
      kind: ExtendedKind.WEB_BOOKMARK,
      created_at: 20,
      tags: [['d', 'example.com']]
    })
    expect(pickNewestReplaceableRevision([older, newer])).toBe(newer)
    expect(compareReplaceableRevision(newer, older)).toBeGreaterThan(0)
  })

  it('collapses stale addressable revisions in a feed batch', () => {
    const kind1 = fakeEvent({ kind: 1, created_at: 99, tags: [], content: 'note' })
    const older = fakeEvent({
      id: '1'.repeat(64),
      kind: ExtendedKind.WEB_BOOKMARK,
      created_at: 10,
      tags: [['d', 'example.com']]
    })
    const newer = fakeEvent({
      id: '2'.repeat(64),
      kind: ExtendedKind.WEB_BOOKMARK,
      created_at: 20,
      tags: [['d', 'example.com']]
    })
    const out = collapseStaleAddressableRevisions([kind1, older, newer])
    expect(out).toEqual([kind1, newer])
    expect(dedupeLatestAddressableEvents([older, newer])).toEqual([newer])
  })

  it('supersedes older addressable rows in a by-id map', () => {
    const byId = new Map<string, Event>()
    const older = fakeEvent({
      id: '1'.repeat(64),
      kind: ExtendedKind.WEB_BOOKMARK,
      created_at: 10,
      tags: [['d', 'example.com']]
    })
    const newer = fakeEvent({
      id: '2'.repeat(64),
      kind: ExtendedKind.WEB_BOOKMARK,
      created_at: 20,
      tags: [['d', 'example.com']]
    })
    upsertEventMapPreferNewestAddressable(byId, older)
    upsertEventMapPreferNewestAddressable(byId, newer)
    expect([...byId.values()]).toEqual([newer])
  })
})
