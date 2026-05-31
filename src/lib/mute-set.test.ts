import { describe, expect, it } from 'vitest'
import { kinds } from 'nostr-tools'
import { filterEventsExcludingMutedAuthors } from './mute-set'

describe('filterEventsExcludingMutedAuthors', () => {
  it('drops events from muted pubkeys', () => {
    const muted = 'a'.repeat(64)
    const other = 'b'.repeat(64)
    const events = [
      { kind: kinds.ShortTextNote, pubkey: muted, id: '1'.repeat(64), sig: 's', tags: [], content: '', created_at: 1 },
      { kind: kinds.ShortTextNote, pubkey: other, id: '2'.repeat(64), sig: 's', tags: [], content: '', created_at: 1 }
    ]
    const out = filterEventsExcludingMutedAuthors(events, new Set([muted]))
    expect(out).toHaveLength(1)
    expect(out[0]?.pubkey).toBe(other)
  })
})
