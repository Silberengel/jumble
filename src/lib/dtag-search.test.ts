import { describe, expect, it } from 'vitest'
import {
  compareEventsForDTagQuery,
  compareEventsForDTagQueryWithPriorityKind,
  compareMergedGeneralSearchHits,
  eventMatchesDTagQuery
} from '@/lib/dtag-search'
import { ExtendedKind } from '@/constants'
import type { Event } from 'nostr-tools'

function ev(id: string, created_at: number, d?: string, kind = 30023): Event {
  return {
    id,
    kind,
    pubkey: 'a'.repeat(64),
    created_at,
    tags: d ? [['d', d]] : [],
    content: '',
    sig: 'b'.repeat(128)
  }
}

function dEvent(d: string | undefined, extra: { content?: string; tags?: string[][] } = {}): Event {
  return {
    id: 'c'.repeat(64),
    kind: ExtendedKind.WIKI_ARTICLE,
    pubkey: 'a'.repeat(64),
    created_at: 1,
    tags: [...(d ? [['d', d]] : []), ...(extra.tags ?? [])],
    content: extra.content ?? '',
    sig: 'b'.repeat(128)
  }
}

describe('eventMatchesDTagQuery', () => {
  it('matches the exact d-tag and d-tags that contain the needle', () => {
    expect(eventMatchesDTagQuery('istanbul', dEvent('istanbul'))).toBe(true)
    expect(eventMatchesDTagQuery('istanbul', dEvent('new-istanbul'))).toBe(true)
    expect(eventMatchesDTagQuery('istanbul', dEvent('istanbul-3'))).toBe(true)
  })

  it('does NOT match when the needle only appears in content or metadata tags', () => {
    expect(
      eventMatchesDTagQuery(
        'quantum-mechanics',
        dEvent('wikipedia', {
          content: 'A reader who consults the article on quantum mechanics ...',
          tags: [['title', 'Wikipedia']]
        })
      )
    ).toBe(false)
    expect(
      eventMatchesDTagQuery('istanbul', dEvent('wikipedia', { tags: [['summary', 'About Istanbul']] }))
    ).toBe(false)
  })

  it('treats hyphens and spaces as equivalent', () => {
    expect(eventMatchesDTagQuery('quantum mechanics', dEvent('quantum-mechanics'))).toBe(true)
    expect(eventMatchesDTagQuery('quantum-mechanics', dEvent('intro-quantum-mechanics'))).toBe(true)
  })

  it('returns false for events without a d-tag, and true for an empty needle', () => {
    expect(eventMatchesDTagQuery('istanbul', dEvent(undefined, { content: 'istanbul' }))).toBe(false)
    expect(eventMatchesDTagQuery('   ', dEvent('anything'))).toBe(true)
  })
})

describe('compareMergedGeneralSearchHits', () => {
  it('ranks local archive hits before relay-only hits', () => {
    const local = { event: ev('1'.repeat(64), 100), fromLocalArchive: true }
    const relay = { event: ev('2'.repeat(64), 200) }
    expect(compareMergedGeneralSearchHits('foo', local, relay)).toBeLessThan(0)
    expect(compareMergedGeneralSearchHits('foo', relay, local)).toBeGreaterThan(0)
  })
})

describe('compareEventsForDTagQueryWithPriorityKind', () => {
  const wiki = ExtendedKind.WIKI_ARTICLE

  it('floats the priority kind to the top regardless of d-tag match quality', () => {
    // Wiki page with a loose match vs. a long-form article with an exact d-tag match.
    const wikiLoose = ev('1'.repeat(64), 100, 'april-notes', wiki)
    const articleExact = ev('2'.repeat(64), 200, 'april', 30023)
    expect(compareEventsForDTagQueryWithPriorityKind('april', wiki, wikiLoose, articleExact)).toBeLessThan(0)
    expect(compareEventsForDTagQueryWithPriorityKind('april', wiki, articleExact, wikiLoose)).toBeGreaterThan(0)
  })

  it('falls back to normal d-tag ordering within the priority kind', () => {
    const exact = ev('1'.repeat(64), 100, 'april', wiki)
    const loose = ev('2'.repeat(64), 200, 'april-notes', wiki)
    expect(compareEventsForDTagQueryWithPriorityKind('april', wiki, exact, loose)).toBeLessThan(0)
  })
})

describe('compareEventsForDTagQuery', () => {
  it('ranks spaced query exact d/T above a newer content-only wiki hit', () => {
    const halle = {
      id: 'e'.repeat(64),
      kind: ExtendedKind.WIKI_ARTICLE,
      pubkey: 'a'.repeat(64),
      created_at: 1_786_614_997,
      tags: [
        ['d', 'halle-berry'],
        ['title', 'Halle Berry'],
        ['T', 'halle-berry']
      ],
      content: 'Halle Maria Berry is an American actress.',
      sig: 'b'.repeat(128)
    } satisfies Event
    const april = {
      id: 'f'.repeat(64),
      kind: ExtendedKind.WIKI_ARTICLE,
      pubkey: 'a'.repeat(64),
      created_at: 1_786_616_499,
      tags: [
        ['d', 'april-10'],
        ['title', 'April 10'],
        ['T', 'april-10']
      ],
      content: "Halley's Comet · Kevin Berry",
      sig: 'b'.repeat(128)
    } satisfies Event

    expect(compareEventsForDTagQuery('Halle Berry', halle, april)).toBeLessThan(0)
    expect(compareEventsForDTagQuery('Halle Berry', april, halle)).toBeGreaterThan(0)
    expect(compareEventsForDTagQuery('halle-berry', halle, april)).toBeLessThan(0)
  })

  it('ranks exact T match when d is unrelated', () => {
    const byT = dEvent('other-slug', { tags: [['T', 'halle-berry']] })
    const unrelated = dEvent('april-10')
    unrelated.created_at = 99
    byT.created_at = 1
    expect(compareEventsForDTagQuery('Halle Berry', byT, unrelated)).toBeLessThan(0)
  })
})
