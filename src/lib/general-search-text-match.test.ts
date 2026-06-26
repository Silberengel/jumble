import { describe, expect, it } from 'vitest'
import {
  buildRelayContentSearchQuery,
  eventMatchesGeneralSearchQuery,
  findSearchHighlightNeedle,
  generalSearchHaystack,
  generalSearchQueryTerms,
  haystackMatchesPhraseQuery,
  normalizeGeneralSearchQuery,
  normalizeSearchMatchText,
  scorePublicationContentEventSearchQuery,
  scorePublicationContentSearchQuery
} from '@/lib/general-search-text-match'
import type { Event } from 'nostr-tools'

function ev(partial: Partial<Event> & Pick<Event, 'kind' | 'content'>): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_700_000_000,
    sig: 'sig',
    tags: [],
    ...partial
  }
}

describe('normalizeGeneralSearchQuery', () => {
  it('strips outer double quotes and collapses whitespace', () => {
    expect(normalizeGeneralSearchQuery('"Nostr is a thankless protocol."')).toBe(
      'Nostr is a thankless protocol.'
    )
    expect(normalizeGeneralSearchQuery('  foo   bar  ')).toBe('foo bar')
  })

  it('extracts significant terms without punctuation', () => {
    expect(generalSearchQueryTerms('"thankless protocol"')).toEqual(['thankless', 'protocol'])
  })
})

describe('eventMatchesGeneralSearchQuery', () => {
  it('matches content and ignores pubkey/id substrings', () => {
    const note = ev({ kind: 1, content: 'Hello bitcoin world' })
    expect(eventMatchesGeneralSearchQuery(note, 'bitcoin')).toBe(true)
    expect(eventMatchesGeneralSearchQuery(note, note.pubkey.slice(0, 8))).toBe(false)
  })

  it('matches title and summary tags', () => {
    const article = ev({
      kind: 30023,
      content: 'body',
      tags: [
        ['title', 'My Article Title'],
        ['summary', 'A short summary here']
      ]
    })
    expect(eventMatchesGeneralSearchQuery(article, 'article title')).toBe(true)
    expect(eventMatchesGeneralSearchQuery(article, 'short summary')).toBe(true)
    expect(generalSearchHaystack(article)).toContain('my article title')
  })

  it('matches multi-word queries when all words appear in haystack', () => {
    const note = ev({ kind: 1, content: 'foo bar baz' })
    expect(eventMatchesGeneralSearchQuery(note, 'foo baz')).toBe(true)
    expect(eventMatchesGeneralSearchQuery(note, 'foo missing')).toBe(false)
  })

  it('matches quoted phrase against note content', () => {
    const note = ev({ kind: 1, content: 'Nostr is a thankless protocol.' })
    expect(eventMatchesGeneralSearchQuery(note, '"Nostr is a thankless protocol."')).toBe(true)
  })

  it('quoted content search requires exact phrase not scattered words', () => {
    const quote = '"I urged, when he halted once more."'
    const exact = 'She said: I urged, when he halted once more. Then paused.'
    const scattered = 'They urged him when he once walked. More text here.'
    expect(scorePublicationContentSearchQuery(exact, quote)).toBeGreaterThan(10_000)
    expect(scorePublicationContentSearchQuery(scattered, quote)).toBe(0)
  })

  it('ranks phrase match above scattered multi-word match', () => {
    const query = 'I urged, when he halted once more.'
    const phrase = 'I urged, when he halted once more.'
    const scattered = 'I had urged them when he halted. Once more they tried.'
    const phraseScore = scorePublicationContentSearchQuery(phrase, query)
    const scatteredScore = scorePublicationContentSearchQuery(scattered, query)
    expect(phraseScore).toBeGreaterThan(10_000)
    expect(scatteredScore).toBeGreaterThan(0)
    expect(scatteredScore).toBeLessThan(phraseScore)
  })

  it('matches Grimms quote when query is wrapped in straight double quotes', () => {
    const section = ev({
      kind: 30041,
      content:
        'Little brother took his little sister by the hand and said, “Since our\nmother died, we have had no happiness; our stepmother beats us every day',
      tags: [['d', 'pg52521-chapter-5-little-brother-and-little-sister'], ['title', 'Little Brother and Little Sister']]
    })
    const query =
      '"Since our mother died, we have had no happiness; our stepmother beats us every day"'

    expect(scorePublicationContentEventSearchQuery(section, query)).toBeGreaterThan(10_000)
  })

  it('matches kind-30041 body when phrase spans a hard line break', () => {
    const section = ev({
      kind: 30041,
      content:
        'Such was the fault found in Callippides, as also in others of our own day, who are\ncensured for representing degraded women.',
      tags: [['d', 'pg1974-chapter-18-xxvi']]
    })
    const query = '"who are censured for representing degraded women"'

    expect(scorePublicationContentEventSearchQuery(section, query)).toBeGreaterThan(10_000)
    expect(scorePublicationContentSearchQuery(section.content, query)).toBeGreaterThan(10_000)
  })

  // AsciiDoctor rewrites source markup when rendering (double hyphen -> em dash + zero-width space,
  // ... -> ellipsis, straight quotes -> curly). The query a user types and the text Ctrl+F finds in the
  // DOM therefore differ by punctuation/markup only; phrase matching must look through all of it.
  describe('punctuation and markup tolerance', () => {
    // \u2014 = em dash, \u200B = zero-width space AsciiDoctor inserts after it, \u2026 = ellipsis.
    const rendered =
      'Not at all, not at all! How coarsely, how stupidly\u2014\u200Bexcuse me saying\nso\u2014\u200Byou misunderstand the word development! Good heavens, how\u2026 crude\nyou still are! It was eight o\u2019clock now.'

    it('matches a phrase whose source double-hyphen renders as em dash + zero-width space', () => {
      const query =
        'How coarsely, how stupidly\u2014excuse me saying so\u2014you misunderstand the word development'
      expect(haystackMatchesPhraseQuery(rendered, query)).toBe(true)
      expect(scorePublicationContentSearchQuery(rendered, query)).toBeGreaterThan(10_000)
    })

    it('matches across a typed double hyphen against rendered em dash', () => {
      const query = 'how stupidly--excuse me saying so--you misunderstand'
      expect(haystackMatchesPhraseQuery(rendered, query)).toBe(true)
    })

    it('matches "..." in the query against a rendered ellipsis', () => {
      expect(haystackMatchesPhraseQuery(rendered, 'Good heavens, how... crude you still are')).toBe(true)
    })

    it('matches straight apostrophe against rendered curly apostrophe', () => {
      expect(haystackMatchesPhraseQuery(rendered, "it was eight o'clock now")).toBe(true)
    })

    it('returns a highlight needle that spans em dash + zero-width space and exists verbatim in the text', () => {
      const query =
        'how stupidly\u2014excuse me saying so\u2014you misunderstand the word development'
      const needle = findSearchHighlightNeedle(rendered, query)
      expect(needle).toBeTruthy()
      // The needle must be a verbatim slice of the haystack so DOM indexOf highlighting can locate it.
      expect(rendered.includes(needle as string)).toBe(true)
      expect((needle as string).includes('\u200B')).toBe(true)
    })

    it('normalizes ellipsis, em dash, curly quotes and zero-width to the same tokens', () => {
      expect(normalizeSearchMatchText('how... crude\u2014\u200Bo\u2019clock')).toBe(
        normalizeSearchMatchText("how crude -- o'clock")
      )
    })
  })

  it('matches kind-30041 title tag when phrase is only in title not body', () => {
    const section = ev({
      kind: 30041,
      content: 'being, and have no clear patterns in their minds of justice',
      tags: [
        ['d', 'pg55201-chapter-13-book-vi'],
        ['title', 'BOOK VI. *484* Having determined that the many have no knowledge of true']
      ]
    })
    expect(
      scorePublicationContentEventSearchQuery(section, '"Having determined that the many"')
    ).toBeGreaterThan(10_000)
    expect(scorePublicationContentSearchQuery(section.content, '"Having determined that the many"')).toBe(
      0
    )
  })
})

describe('buildRelayContentSearchQuery', () => {
  it('returns short queries unchanged', () => {
    expect(buildRelayContentSearchQuery('inferno dante')).toBe('inferno dante')
  })

  it('caps a long passage to the configured word budget', () => {
    const passage =
      'Not at all, not at all! How coarsely, how stupidly—excuse me saying so—you misunderstand the word development!'
    const relayQuery = buildRelayContentSearchQuery(passage, { maxWords: 6, maxChars: 200 })
    expect(relayQuery.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(6)
  })

  it('keeps the most distinctive window rather than leading stopwords', () => {
    const passage =
      'Not at all, not at all! How coarsely, how stupidly—excuse me saying so—you misunderstand the word development!'
    const relayQuery = buildRelayContentSearchQuery(passage, { maxWords: 6, maxChars: 200 })
    // The window should favor content words, not the opening "not at all, not at all" stopword run.
    expect(relayQuery).toContain('misunderstand')
    expect(relayQuery.startsWith('not at all')).toBe(false)
  })

  it('respects the character budget at word boundaries', () => {
    const passage = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima'
    const relayQuery = buildRelayContentSearchQuery(passage, { maxWords: 12, maxChars: 20 })
    expect(relayQuery.length).toBeLessThanOrEqual(20)
    expect(relayQuery).not.toMatch(/\s$/)
  })

  it('never returns an empty string for non-empty input', () => {
    expect(buildRelayContentSearchQuery('supercalifragilisticexpialidocious', { maxChars: 5 })).not.toBe('')
  })
})
