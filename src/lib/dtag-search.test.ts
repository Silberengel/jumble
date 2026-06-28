import { describe, expect, it } from 'vitest'
import {
  compareEventsForDTagQueryWithPriorityKind,
  compareMergedGeneralSearchHits
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
