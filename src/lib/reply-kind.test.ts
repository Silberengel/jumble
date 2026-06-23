import { ExtendedKind } from '@/constants'
import { eventHasKind1111CompatibleClientTag, resolveReplyDraftKind } from '@/lib/reply-kind'
import { kinds, type Event } from 'nostr-tools'
import { describe, expect, it } from 'vitest'

function note(overrides: Partial<Event> & Pick<Event, 'kind' | 'tags'>): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1,
    sig: 'sig',
    content: '',
    ...overrides
  } as Event
}

describe('eventHasKind1111CompatibleClientTag', () => {
  it('matches all aitherboard2-listed clients case-insensitively', () => {
    for (const name of [
      'aitherboard',
      'Dark Wisp',
      'jumble',
      'amethyst',
      'imwald',
      'noornote',
      'RelayTools-android'
    ]) {
      expect(
        eventHasKind1111CompatibleClientTag(note({ kind: 1, tags: [['client', name]] }))
      ).toBe(true)
    }
    expect(
      eventHasKind1111CompatibleClientTag(
        note({ kind: 1, tags: [['client', 'Imwald', '31990:abc:imwald']] })
      )
    ).toBe(true)
  })

  it('ignores unrelated client tags', () => {
    expect(
      eventHasKind1111CompatibleClientTag(note({ kind: 1, tags: [['client', 'damus']] }))
    ).toBe(false)
    expect(eventHasKind1111CompatibleClientTag(note({ kind: 1, tags: [] }))).toBe(false)
  })
})

describe('resolveReplyDraftKind', () => {
  it('uses kind 1 for kind-1 parent without 1111-compatible client tag', () => {
    expect(
      resolveReplyDraftKind(note({ kind: kinds.ShortTextNote, tags: [['client', 'damus']] }))
    ).toBe(kinds.ShortTextNote)
  })

  it('uses kind 1111 for kind-1 parent with 1111-compatible client tag', () => {
    expect(
      resolveReplyDraftKind(note({ kind: kinds.ShortTextNote, tags: [['client', 'imwald']] }))
    ).toBe(ExtendedKind.COMMENT)
  })

  it('uses kind 1111 for non-kind-1 parent', () => {
    expect(
      resolveReplyDraftKind(note({ kind: ExtendedKind.COMMENT, tags: [['K', '1'], ['E', 'c'.repeat(64)]] }))
    ).toBe(ExtendedKind.COMMENT)
  })

  it('uses kind 1 for kind-1 root without 1111-compatible client tag', () => {
    expect(
      resolveReplyDraftKind(undefined, note({ kind: kinds.ShortTextNote, tags: [] }))
    ).toBe(kinds.ShortTextNote)
  })
})
