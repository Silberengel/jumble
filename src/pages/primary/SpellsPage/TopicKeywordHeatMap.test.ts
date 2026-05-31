import { describe, expect, it } from 'vitest'
import { kinds } from 'nostr-tools'
import { DEFAULT_FEED_SHOW_KINDS } from '@/constants'
import { buildTopicKeywordBubbles } from './TopicKeywordHeatMap'

function note(pubkey: string, tags: string[][], content = '') {
  return {
    kind: kinds.ShortTextNote,
    pubkey,
    content,
    tags,
    id: `${pubkey.slice(0, 8)}${'a'.repeat(56)}`,
    sig: 'b'.repeat(128),
    created_at: 1_700_000_000
  }
}

describe('buildTopicKeywordBubbles', () => {
  it('ranks pubkeys by how often they used the topic', () => {
    const pkA = 'a'.repeat(64)
    const pkB = 'b'.repeat(64)
    const pkC = 'c'.repeat(64)
    const bubbles = buildTopicKeywordBubbles(
      [
        note(pkA, [['t', 'nostr']]),
        note(pkA, [['t', 'nostr']]),
        note(pkB, [['t', 'nostr']]),
        note(pkC, [], 'hello #nostr'),
        note(pkC, [], 'again #nostr')
      ],
      DEFAULT_FEED_SHOW_KINDS,
      true,
      true,
      true
    )
    const nostr = bubbles.find((b) => b.key === 'nostr')
    expect(nostr?.pubkeys[0]).toBe(pkA)
    expect(nostr?.pubkeys).toContain(pkC)
    expect(nostr?.pubkeys).toContain(pkB)
  })

  it('excludes muted authors from counts and bubble avatars', () => {
    const pkA = 'a'.repeat(64)
    const pkMuted = 'f'.repeat(64)
    const pkB = 'b'.repeat(64)
    const bubbles = buildTopicKeywordBubbles(
      [
        note(pkA, [['t', 'nostr']]),
        note(pkMuted, [['t', 'nostr']], 'muted #nostr'),
        note(pkB, [['t', 'nostr']])
      ],
      DEFAULT_FEED_SHOW_KINDS,
      true,
      true,
      true,
      new Set([pkMuted])
    )
    const nostr = bubbles.find((b) => b.key === 'nostr')
    expect(nostr?.score).toBe(2)
    expect(nostr?.pubkeys).not.toContain(pkMuted)
  })
})
