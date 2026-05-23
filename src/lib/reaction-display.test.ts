import { describe, expect, it } from 'vitest'
import { kinds } from 'nostr-tools'
import {
  collectReactionAuthorPubkeysForEmojiPrefetch,
  reactionNeedsAuthorEmojiLookup,
  resolveAuthorEmojiForReactionShortcode,
  resolveReactionEmojiSync
} from './reaction-display'

function reactionEvent(
  content: string,
  tags: string[][] = [],
  pubkey = 'aa'.repeat(32)
) {
  return {
    kind: kinds.Reaction,
    id: 'bb'.repeat(32),
    pubkey,
    content,
    tags,
    created_at: 1,
    sig: 'cc'.repeat(32)
  }
}

describe('resolveReactionEmojiSync', () => {
  it('uses emoji tag when content is a custom shortcode', () => {
    const event = reactionEvent(':jumble:', [
      ['emoji', 'jumble', 'https://cdn.example/jumble.png']
    ])
    const result = resolveReactionEmojiSync(event, 64)
    expect(result).toEqual({
      mode: 'display',
      value: { shortcode: 'jumble', url: 'https://cdn.example/jumble.png' }
    })
  })

  it('matches emoji tags case-insensitively', () => {
    const event = reactionEvent(':Jumble:', [
      ['emoji', 'jumble', 'https://cdn.example/jumble.png']
    ])
    const result = resolveReactionEmojiSync(event, 64)
    expect(result.mode).toBe('display')
    if (result.mode === 'display' && typeof result.value === 'object') {
      expect(result.value.url).toBe('https://cdn.example/jumble.png')
    }
  })

  it('defers unknown custom shortcodes to author lookup', () => {
    const event = reactionEvent(':unknown_custom:', [])
    expect(reactionNeedsAuthorEmojiLookup(event)).toBe(true)
    expect(resolveReactionEmojiSync(event, 64)).toEqual({
      mode: 'profile',
      shortcode: 'unknown_custom',
      placeholder: ':unknown_custom:'
    })
  })

  it('resolves URL content from emoji tag', () => {
    const url = 'https://cdn.example/emoji.png'
    const event = reactionEvent(url, [['emoji', 'pic', url]])
    const result = resolveReactionEmojiSync(event, 64)
    expect(result).toEqual({
      mode: 'display',
      value: { shortcode: 'pic', url }
    })
  })
})

describe('collectReactionAuthorPubkeysForEmojiPrefetch', () => {
  it('collects reactor pubkeys for profile-lookup reactions', () => {
    const pk = 'dd'.repeat(32)
    const event = reactionEvent(':custom:', [], pk)
    const set = new Set<string>()
    collectReactionAuthorPubkeysForEmojiPrefetch([event], set)
    expect(set.has(pk)).toBe(true)
  })

  it('skips reactions with inline emoji tags', () => {
    const pk = 'ee'.repeat(32)
    const event = reactionEvent(':custom:', [['emoji', 'custom', 'https://x/y.png']], pk)
    const set = new Set<string>()
    collectReactionAuthorPubkeysForEmojiPrefetch([event], set)
    expect(set.size).toBe(0)
  })
})

describe('resolveAuthorEmojiForReactionShortcode', () => {
  it('finds shortcodes case-insensitively', () => {
    const hit = resolveAuthorEmojiForReactionShortcode(
      [{ shortcode: 'Firefly', url: 'https://cdn.example/f.png' }],
      'firefly'
    )
    expect(hit?.url).toBe('https://cdn.example/f.png')
  })
})
