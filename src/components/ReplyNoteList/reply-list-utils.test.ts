import { describe, expect, it } from 'vitest'
import { kinds, type Event } from 'nostr-tools'
import { insertMissingStatsReplyPlaceholders } from './reply-list-utils'

function note(id: string, created_at: number): Event {
  return {
    id,
    pubkey: 'a'.repeat(64),
    kind: kinds.ShortTextNote,
    tags: [],
    content: '',
    created_at,
    sig: 'sig'
  }
}

describe('insertMissingStatsReplyPlaceholders', () => {
  it('inserts missing stats ids as placeholder rows', () => {
    const resolved = [note('b'.repeat(64), 200)]
    const stats = [
      { id: 'c'.repeat(64), pubkey: 'd'.repeat(64), created_at: 100 },
      { id: 'b'.repeat(64), pubkey: 'a'.repeat(64), created_at: 200 }
    ]
    const out = insertMissingStatsReplyPlaceholders(resolved, stats, 'oldest')
    expect(out).toHaveLength(2)
    expect(out[0]?.type).toBe('missing')
    expect(out[1]?.type).toBe('event')
  })

  it('skips placeholders for resolved ids', () => {
    const id = 'e'.repeat(64)
    const resolved = [note(id, 100)]
    const stats = [{ id, pubkey: 'a'.repeat(64), created_at: 100 }]
    const out = insertMissingStatsReplyPlaceholders(resolved, stats, 'oldest')
    expect(out).toHaveLength(1)
    expect(out[0]?.type).toBe('event')
  })
})
