import { describe, expect, it } from 'vitest'
import { rankStandardEmojiShortcodes } from './emoji-suggestion-items'

describe('rankStandardEmojiShortcodes', () => {
  it('returns arrow shortcodes for query "arrow"', () => {
    const hits = rankStandardEmojiShortcodes('arrow', 50)
    expect(hits.length).toBeGreaterThan(5)
    expect(hits.some((s) => s === 'arrow_up')).toBe(true)
    expect(hits.some((s) => s === 'bow_and_arrow')).toBe(true)
  })

  it('returns empty for blank query', () => {
    expect(rankStandardEmojiShortcodes('')).toEqual([])
    expect(rankStandardEmojiShortcodes('   ')).toEqual([])
  })
})
