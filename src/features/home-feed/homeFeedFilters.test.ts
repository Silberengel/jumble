import { describe, expect, it } from 'vitest'
import { filterVisibleHomeFeedEvents, shouldHideHomeFeedEvent } from './homeFeedFilters'
import type { HomeFeedFilterContext } from './homeFeedFilters'
import { kinds } from 'nostr-tools'
import type { Event } from 'nostr-tools'

function note(id: string, created_at: number, pubkey = 'aa'.repeat(32)): Event {
  return {
    id,
    pubkey,
    created_at,
    kind: kinds.ShortTextNote,
    tags: [],
    content: 'hello',
    sig: 'sig'
  }
}

const baseCtx = (): HomeFeedFilterContext => ({
  listMode: 'posts',
  hideReplies: true,
  showKinds: [1],
  showKind1OPs: true,
  showKind1Replies: false,
  showKind1111: false,
  applyKindPickerInUi: true,
  seeAllFeedEvents: false,
  filterMutedNotes: false,
  hideContentMentioningMutedUsers: false,
  mutePubkeySet: new Set(),
  attestedSuperchatIds: new Set(),
  relayAuthoritativeFeedOnly: false,
  getSeenOnRelays: () => []
})

describe('shouldHideHomeFeedEvent', () => {
  it('hides implausible created_at', () => {
    const ctx = baseCtx()
    expect(shouldHideHomeFeedEvent(note('a', 4102444800), ctx)).toBe(true)
  })

  it('hides events not seen on allowlist in posts mode', () => {
    const ctx: HomeFeedFilterContext = {
      ...baseCtx(),
      seenOnAllowlist: ['wss://allowed.example.com/'],
      getSeenOnRelays: () => ['wss://other.example.com/']
    }
    expect(shouldHideHomeFeedEvent(note('a', 1_700_000_000), ctx)).toBe(true)
  })

  it('hides unknown seen-on on strict relay-authoritative feeds', () => {
    const ctx: HomeFeedFilterContext = {
      ...baseCtx(),
      relayAuthoritativeFeedOnly: true,
      seenOnAllowlist: ['wss://allowed.example.com/'],
      getSeenOnRelays: () => []
    }
    expect(shouldHideHomeFeedEvent(note('a', 1_700_000_000), ctx)).toBe(true)
  })
})

describe('filterVisibleHomeFeedEvents', () => {
  it('respects kind picker', () => {
    const ts = 1_700_000_000
    const events = [
      note('a', ts),
      { ...note('b', ts - 1), kind: 6, tags: [['e', 'x']] }
    ]
    const visible = filterVisibleHomeFeedEvents(events, baseCtx(), 10)
    expect(visible.map((e) => e.id)).toEqual(['a'])
  })
})
