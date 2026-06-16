import { describe, expect, it } from 'vitest'
import { compareMergedGeneralSearchHits } from '@/lib/dtag-search'
import type { Event } from 'nostr-tools'

function ev(id: string, created_at: number, d?: string): Event {
  return {
    id,
    kind: 30023,
    pubkey: 'a'.repeat(64),
    created_at,
    tags: d ? [['d', d]] : [],
    content: '',
    sig: 'b'.repeat(128)
  }
}

describe('compareMergedGeneralSearchHits', () => {
  it('ranks local archive hits before relay-only hits', () => {
    const local = { event: ev('1'.repeat(64), 100), fromLocalArchive: true }
    const relay = { event: ev('2'.repeat(64), 200) }
    expect(compareMergedGeneralSearchHits('foo', local, relay)).toBeLessThan(0)
    expect(compareMergedGeneralSearchHits('foo', relay, local)).toBeGreaterThan(0)
  })
})
