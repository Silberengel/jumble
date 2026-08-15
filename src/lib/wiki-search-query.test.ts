import { describe, expect, it } from 'vitest'
import { ExtendedKind } from '@/constants'
import {
  planWikiSearchQuery,
  wikiEventMatchesSearchPlan,
  wikiIdentifierFiltersFromPlan
} from '@/lib/wiki-search-query'
import type { Event } from 'nostr-tools'

describe('planWikiSearchQuery', () => {
  it('derives aardvark d-tag and title from a Wikipedia URL (not a mangled URL slug)', () => {
    const plan = planWikiSearchQuery('https://en.wikipedia.org/wiki/Aardvark')
    expect(plan.dTags).toContain('aardvark')
    expect(plan.dTags.some((d) => d.includes('wikipedia'))).toBe(false)
    expect(plan.titleNeedles).toEqual(expect.arrayContaining(['Aardvark']))
    expect(plan.textQueries).toContain('Aardvark')
    expect(plan.expanded.i).toEqual(
      expect.arrayContaining([
        'wikipedia:en:Aardvark',
        'wikipedia:en:aardvark',
        'https://en.wikipedia.org/wiki/Aardvark'
      ])
    )
    expect(plan.expanded.s).toContain('https://en.wikipedia.org/wiki/Aardvark')
  })

  it('wikiIdentifierFiltersFromPlan includes URL on #i and #s', () => {
    const plan = planWikiSearchQuery('https://en.wikipedia.org/wiki/Aardvark')
    const filters = wikiIdentifierFiltersFromPlan(plan, 50)
    expect(
      filters.some((f) =>
        (f as { '#i'?: string[] })['#i']?.includes('https://en.wikipedia.org/wiki/Aardvark')
      )
    ).toBe(true)
    expect(filters.some((f) => (f as { '#s'?: string[] })['#s']?.length)).toBe(true)
    expect(filters.some((f) => (f as { '#source'?: string[] })['#source']?.length)).toBe(false)
    expect(filters.some((f) => (f as { '#d'?: string[] })['#d']?.includes('aardvark'))).toBe(true)
  })

  it('plans Babalu_(comedian) as wikipedia page with d-tag babalu-comedian', () => {
    const plan = planWikiSearchQuery('Babalu_(comedian)')
    expect(plan.dTags).toContain('babalu-comedian')
    expect(plan.titleNeedles).toEqual(
      expect.arrayContaining(['Babalu (comedian)', 'Babalu_(comedian)'])
    )
    expect(plan.expanded.i).toEqual(
      expect.arrayContaining(['wikipedia:en:Babalu_(comedian)'])
    )
  })

  it('wikiEventMatchesSearchPlan matches catalog i/s/d for Wikipedia URL paste', () => {
    const plan = planWikiSearchQuery('https://en.wikipedia.org/wiki/Aardvark')
    const event = {
      kind: ExtendedKind.WIKI_ARTICLE,
      tags: [
        ['d', 'aardvark'],
        ['title', 'Aardvark'],
        ['s', 'https://en.wikipedia.org/wiki/Aardvark'],
        ['i', 'wikipedia:en:Aardvark']
      ]
    } as Event
    expect(wikiEventMatchesSearchPlan(event, plan, () => false)).toBe(true)
  })

  it('wikiEventMatchesSearchPlan matches URL-only i tag', () => {
    const plan = planWikiSearchQuery('https://en.wikipedia.org/wiki/Aardvark')
    const event = {
      kind: ExtendedKind.WIKI_ARTICLE,
      tags: [['d', 'aardvark'], ['i', 'https://en.wikipedia.org/wiki/Aardvark']]
    } as Event
    expect(wikiEventMatchesSearchPlan(event, plan, () => false)).toBe(true)
  })
})
