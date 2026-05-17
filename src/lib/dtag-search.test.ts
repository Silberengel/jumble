import { describe, expect, it } from 'vitest'
import { compareMergedNip50SearchHits } from '@/lib/dtag-search'
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

describe('compareMergedNip50SearchHits', () => {
  it('ranks local archive hits before relay-only hits', () => {
    const local = { event: ev('1'.repeat(64), 100), fromLocalArchive: true }
    const relay = { event: ev('2'.repeat(64), 200) }
    expect(compareMergedNip50SearchHits('foo', local, relay)).toBeLessThan(0)
    expect(compareMergedNip50SearchHits('foo', relay, local)).toBeGreaterThan(0)
  })
})
