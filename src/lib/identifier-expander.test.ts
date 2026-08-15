import { describe, expect, it } from 'vitest'
import {
  buildIdentifierSearchFilters,
  eventMatchesExpandedIdentifier,
  expandIdentifier,
  queryLooksLikePastedIdentifier
} from '@/lib/identifier-expander'
import { ExtendedKind } from '@/constants'

describe('expandIdentifier', () => {
  it('returns empty for blank input', () => {
    expect(expandIdentifier('')).toEqual({})
    expect(expandIdentifier('   ')).toEqual({})
  })

  it('expands wikipedia URLs to s + i (URL also in i) + d', () => {
    const url = 'https://en.wikipedia.org/wiki/The_Whore_(2010_film)'
    const expanded = expandIdentifier(url)
    expect(expanded.s).toEqual([url])
    expect(expanded.i).toEqual(
      expect.arrayContaining([
        'wikipedia:en:The_Whore_(2010_film)',
        'wikipedia:en:the_whore_(2010_film)',
        url
      ])
    )
    expect(expanded.d).toContain('the-whore-2010-film')
  })

  it('expands wikipedia slug/title terms to i + d', () => {
    expect(expandIdentifier('The_Whore_(2010_film)').i).toEqual(
      expect.arrayContaining(['wikipedia:en:The_Whore_(2010_film)'])
    )
    expect(expandIdentifier('The Whore (2010 film)').d).toContain('the-whore-2010-film')
  })

  it('expands gutenberg URL and bare ids', () => {
    const url = 'https://www.gutenberg.org/ebooks/1342'
    const expanded = expandIdentifier(url)
    expect(expanded.s).toEqual([url])
    expect(expanded.i).toEqual(expect.arrayContaining(['gutenberg:1342', url]))
    expect(expanded.d).toEqual(expect.arrayContaining(['pg1342', '1342']))
    expect(expandIdentifier('1342').i).toEqual(['gutenberg:1342'])
    expect(expandIdentifier('pg1342').d).toContain('pg1342')
  })

  it('expands gutenberg /files/ HTML URLs (with chapter anchors) to gutenberg:id + ebook page', () => {
    const filesUrl =
      'https://www.gutenberg.org/files/1497/1497-h/1497-h.htm#link2H_4_0010'
    const expanded = expandIdentifier(filesUrl)
    expect(expanded.s).toEqual([
      'https://www.gutenberg.org/ebooks/1497',
      'https://www.gutenberg.org/files/1497/1497-h/1497-h.htm'
    ])
    expect(expanded.i).toEqual(
      expect.arrayContaining([
        'gutenberg:1497',
        'https://www.gutenberg.org/ebooks/1497',
        'https://www.gutenberg.org/files/1497/1497-h/1497-h.htm'
      ])
    )
    expect(expanded.d).toEqual(expect.arrayContaining(['pg1497', '1497']))
  })

  it('expands gutenberg /cache/epub/ cover URLs to gutenberg:id', () => {
    const expanded = expandIdentifier(
      'https://www.gutenberg.org/cache/epub/21020/pg21020.cover.medium.jpg'
    )
    expect(expanded.s).toEqual(
      expect.arrayContaining([
        'https://www.gutenberg.org/ebooks/21020',
        'https://www.gutenberg.org/cache/epub/21020/pg21020.cover.medium.jpg'
      ])
    )
    expect(expanded.i).toContain('gutenberg:21020')
  })

  it('eventMatchesExpandedIdentifier matches catalog source/i for files URL paste', () => {
    const expanded = expandIdentifier(
      'https://www.gutenberg.org/files/1497/1497-h/1497-h.htm#link2H_4_0010'
    )
    expect(
      eventMatchesExpandedIdentifier(
        {
          tags: [
            ['d', 'pg1497-the-republic'],
            ['source', 'https://www.gutenberg.org/ebooks/1497'],
            ['i', 'gutenberg:1497']
          ]
        },
        expanded
      )
    ).toBe(true)
  })

  it('eventMatchesExpandedIdentifier matches URL stored only on i (not s/source)', () => {
    const url = 'https://en.wikipedia.org/wiki/Aardvark'
    const expanded = expandIdentifier(url)
    expect(
      eventMatchesExpandedIdentifier(
        {
          tags: [
            ['d', 'aardvark'],
            ['i', url]
          ]
        },
        expanded
      )
    ).toBe(true)
  })

  it('eventMatchesExpandedIdentifier matches d-tag from wikipedia URL paste', () => {
    const expanded = expandIdentifier('https://en.wikipedia.org/wiki/Aardvark')
    expect(
      eventMatchesExpandedIdentifier(
        {
          tags: [['d', 'aardvark'], ['title', 'Aardvark']]
        },
        expanded
      )
    ).toBe(true)
  })

  it('buildIdentifierSearchFilters emits #i/#s/#d', () => {
    const filters = buildIdentifierSearchFilters(
      expandIdentifier('https://en.wikipedia.org/wiki/Aardvark'),
      ExtendedKind.WIKI_ARTICLE,
      50
    )
    const keys = filters.flatMap((f) => Object.keys(f).filter((k) => k.startsWith('#')))
    expect(keys).toEqual(expect.arrayContaining(['#i', '#s', '#d']))
    expect(keys).not.toContain('#source')
    expect(filters.some((f) => (f as { '#d'?: string[] })['#d']?.includes('aardvark'))).toBe(true)
    expect(
      filters.some((f) =>
        (f as { '#i'?: string[] })['#i']?.includes('https://en.wikipedia.org/wiki/Aardvark')
      )
    ).toBe(true)
  })

  it('expands openlibrary URL and OL id', () => {
    const url = 'https://openlibrary.org/works/OL45883W'
    const expanded = expandIdentifier(url)
    expect(expanded.s).toEqual(expect.arrayContaining([url]))
    expect(expanded.i).toEqual(
      expect.arrayContaining(['openlibrary:OL45883W', 'openlibrary:ol45883w', url])
    )
    expect(expanded.d).toEqual(expect.arrayContaining(['ol45883w', 'OL45883W']))
    const bare = expandIdentifier('OL45883W')
    expect(bare.i).toEqual(expect.arrayContaining(['openlibrary:OL45883W']))
    expect(bare.s).toContain('https://openlibrary.org/works/OL45883W')
  })

  it('expands openlibrary /books/ edition URLs and titled works paths', () => {
    const bookUrl = 'https://openlibrary.org/books/OL7353617M/Pride_and_Prejudice'
    const expanded = expandIdentifier(bookUrl)
    expect(expanded.i).toEqual(expect.arrayContaining(['openlibrary:OL7353617M']))
    expect(expanded.s).toEqual(
      expect.arrayContaining([
        'https://openlibrary.org/books/OL7353617M',
        'https://openlibrary.org/books/OL7353617M/Pride_and_Prejudice'
      ])
    )

    const titledWork = 'https://openlibrary.org/works/OL45883W/Pride_and_Prejudice'
    expect(expandIdentifier(titledWork).i).toContain('openlibrary:OL45883W')

    const legacy = expandIdentifier('https://openlibrary.org/b/OL7353617M')
    expect(legacy.i).toEqual(expect.arrayContaining(['openlibrary:OL7353617M']))
    expect(legacy.s).toContain('https://openlibrary.org/books/OL7353617M')
  })

  it('eventMatchesExpandedIdentifier matches openlibrary URL vs openlibrary:i tag', () => {
    const expanded = expandIdentifier(
      'https://openlibrary.org/works/OL45883W/Pride_and_Prejudice'
    )
    expect(
      eventMatchesExpandedIdentifier(
        {
          tags: [
            ['d', 'pride-and-prejudice'],
            ['i', 'openlibrary:OL45883W'],
            ['source', 'https://openlibrary.org/works/OL45883W']
          ]
        },
        expanded
      )
    ).toBe(true)
  })

  it('expands openlibrary ISBN paths and bare ISBN', () => {
    const url = 'https://openlibrary.org/isbn/9780141439512'
    expect(expandIdentifier(url).i).toContain('isbn:9780141439512')
    expect(expandIdentifier('9780141439512')).toEqual({ i: ['isbn:9780141439512'] })
  })

  it('expands wikidata URL and Q id', () => {
    const url = 'https://www.wikidata.org/wiki/Q6511'
    expect(expandIdentifier(url).i).toEqual(expect.arrayContaining(['wikidata:Q6511', url]))
    expect(expandIdentifier('Q6511').i).toEqual(['wikidata:Q6511'])
  })

  it('keeps already-prefixed identifiers as i', () => {
    expect(expandIdentifier('wikipedia:en:Albert_Einstein').i).toEqual(
      expect.arrayContaining(['wikipedia:en:Albert_Einstein'])
    )
    expect(expandIdentifier('gutenberg:1342')).toEqual({
      i: ['gutenberg:1342'],
      d: ['pg1342', '1342']
    })
  })

  it('normalizes www. URLs', () => {
    const expanded = expandIdentifier('www.gutenberg.org/ebooks/42')
    expect(expanded.s).toContain('https://www.gutenberg.org/ebooks/42')
    expect(expanded.i).toContain('gutenberg:42')
  })

  it('expands scheme-less gutenberg host to s and i', () => {
    const expanded = expandIdentifier('gutenberg.org/ebooks/1342')
    expect(expanded.s).toEqual(
      expect.arrayContaining([
        'https://www.gutenberg.org/ebooks/1342',
        'https://gutenberg.org/ebooks/1342'
      ])
    )
    expect(expanded.i).toContain('gutenberg:1342')
  })

  it('expands hyphenated ISBN to i', () => {
    expect(expandIdentifier('978-0141439512')).toEqual({ i: ['isbn:9780141439512'] })
  })
})

describe('queryLooksLikePastedIdentifier', () => {
  it('is false for free-text titles that still expand to d/wikipedia i', () => {
    expect(queryLooksLikePastedIdentifier('Mansfield Park')).toBe(false)
    expect(queryLooksLikePastedIdentifier('Jane Austen')).toBe(false)
    expect(expandIdentifier('Mansfield Park').d?.length).toBeGreaterThan(0)
  })

  it('is true for URLs and scheme/catalog ids', () => {
    expect(queryLooksLikePastedIdentifier('https://www.gutenberg.org/ebooks/141')).toBe(true)
    expect(queryLooksLikePastedIdentifier('gutenberg:141')).toBe(true)
    expect(queryLooksLikePastedIdentifier('pg141')).toBe(true)
    expect(queryLooksLikePastedIdentifier('9780141439512')).toBe(true)
  })
})
