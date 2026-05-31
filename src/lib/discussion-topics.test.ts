import { describe, expect, it } from 'vitest'
import { kinds } from 'nostr-tools'
import { eventMatchesTopicOrContentHashtag, formatTopicMapBubbleLabel, isValidNormalizedTopicKey, normalizedKeyMatchesHashtagPattern, normalizeTopic, relayTopicTagFilterValues } from '@/lib/discussion-topics'

describe('eventMatchesTopicOrContentHashtag', () => {
  it('matches normalized t tags', () => {
    const ev = {
      kind: kinds.ShortTextNote,
      tags: [['t', 'catholic']],
      content: 'hello',
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      sig: 'c'.repeat(128),
      created_at: 1
    }
    expect(eventMatchesTopicOrContentHashtag(ev, 'catholic')).toBe(true)
  })

  it('matches #hashtag in content', () => {
    const ev = {
      kind: kinds.ShortTextNote,
      tags: [],
      content: 'Prayers for the #catholic church today',
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      sig: 'c'.repeat(128),
      created_at: 1
    }
    expect(eventMatchesTopicOrContentHashtag(ev, 'catholic')).toBe(true)
  })

  it('rejects plain text without t tag or #hashtag', () => {
    const ev = {
      kind: kinds.ShortTextNote,
      tags: [],
      content: 'That catholic school is weird',
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      sig: 'c'.repeat(128),
      created_at: 1
    }
    expect(eventMatchesTopicOrContentHashtag(ev, 'catholic')).toBe(false)
  })
})

describe('isValidNormalizedTopicKey', () => {
  it('accepts normalized topic keys', () => {
    expect(isValidNormalizedTopicKey('nostr')).toBe(true)
    expect(isValidNormalizedTopicKey('grownostr')).toBe(true)
  })

  it('rejects empty, numeric-only, and invalid characters', () => {
    expect(isValidNormalizedTopicKey('')).toBe(false)
    expect(isValidNormalizedTopicKey('123')).toBe(false)
    expect(isValidNormalizedTopicKey('-bad')).toBe(false)
  })
})

describe('formatTopicMapBubbleLabel', () => {
  it('shows readable text without a hash prefix', () => {
    expect(formatTopicMapBubbleLabel('decent-newsroom')).toBe('decent newsroom')
    expect(formatTopicMapBubbleLabel('nostr')).toBe('nostr')
  })
})

describe('relayTopicTagFilterValues', () => {
  it('includes plural t-tag variants for singularized map keys', () => {
    expect(relayTopicTagFilterValues('jesu')).toEqual(expect.arrayContaining(['jesu', 'jesus']))
  })
})

describe('normalizedKeyMatchesHashtagPattern', () => {
  it('matches valid ascii hashtag bodies', () => {
    expect(normalizedKeyMatchesHashtagPattern('imwald')).toBe(true)
    expect(normalizedKeyMatchesHashtagPattern('')).toBe(false)
  })
})
