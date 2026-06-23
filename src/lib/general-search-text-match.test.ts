import { describe, expect, it } from 'vitest'
import {
  eventMatchesGeneralSearchQuery,
  generalSearchHaystack,
  generalSearchQueryTerms,
  normalizeGeneralSearchQuery,
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
})
