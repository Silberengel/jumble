import { describe, expect, it } from 'vitest'
import {
  contentNeedsAuthorEmojiLookup,
  mergeEmojiInfosEventOverridesAuthor
} from './useEmojiInfosForEvent'

describe('mergeEmojiInfosEventOverridesAuthor', () => {
  it('lets event shortcodes override author', () => {
    const merged = mergeEmojiInfosEventOverridesAuthor(
      [{ shortcode: 'x', url: 'https://a/a.png' }],
      [{ shortcode: 'x', url: 'https://b/b.png' }]
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]?.url).toBe('https://b/b.png')
  })

  it('merges distinct shortcodes', () => {
    const merged = mergeEmojiInfosEventOverridesAuthor(
      [{ shortcode: 'a', url: 'https://a' }],
      [{ shortcode: 'b', url: 'https://b' }]
    )
    expect(merged.map((e) => e.shortcode).sort()).toEqual(['a', 'b'])
  })
})

describe('contentNeedsAuthorEmojiLookup', () => {
  it('returns false when only standard shortcodes and no event emojis', () => {
    expect(contentNeedsAuthorEmojiLookup('hi :smile: bye', [])).toBe(false)
  })

  it('returns false when custom is on event tags', () => {
    expect(
      contentNeedsAuthorEmojiLookup('hi :chad_yes: bye', [{ shortcode: 'chad_yes', url: 'https://x' }])
    ).toBe(false)
  })

  it('returns true for unknown shortcode without event tag', () => {
    expect(contentNeedsAuthorEmojiLookup(':chad_yes:', [])).toBe(true)
  })
})
