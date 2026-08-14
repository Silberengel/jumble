import { describe, expect, it } from 'vitest'
import { expandIdentifier } from '@/lib/identifier-expander'

describe('expandIdentifier', () => {
  it('returns empty for blank input', () => {
    expect(expandIdentifier('')).toEqual({})
    expect(expandIdentifier('   ')).toEqual({})
  })

  it('expands wikipedia URLs to s + i', () => {
    const url = 'https://en.wikipedia.org/wiki/The_Whore_(2010_film)'
    expect(expandIdentifier(url)).toEqual({
      s: [url],
      i: ['wikipedia:en:The_Whore_(2010_film)']
    })
  })

  it('expands wikipedia slug/title terms to i', () => {
    expect(expandIdentifier('The_Whore_(2010_film)')).toEqual({
      i: ['wikipedia:en:The_Whore_(2010_film)']
    })
    expect(expandIdentifier('The Whore (2010 film)')).toEqual({
      i: ['wikipedia:en:The_Whore_(2010_film)']
    })
  })

  it('expands gutenberg URL and bare ids', () => {
    const url = 'https://www.gutenberg.org/ebooks/1342'
    expect(expandIdentifier(url)).toEqual({
      s: [url],
      i: ['gutenberg:1342']
    })
    expect(expandIdentifier('1342')).toEqual({ i: ['gutenberg:1342'] })
    expect(expandIdentifier('pg1342')).toEqual({ i: ['gutenberg:1342'] })
  })

  it('expands openlibrary URL and OL id', () => {
    const url = 'https://openlibrary.org/works/OL45883W'
    expect(expandIdentifier(url)).toEqual({
      s: [url],
      i: ['openlibrary:OL45883W']
    })
    expect(expandIdentifier('OL45883W')).toEqual({ i: ['openlibrary:OL45883W'] })
  })

  it('expands openlibrary ISBN paths and bare ISBN', () => {
    const url = 'https://openlibrary.org/isbn/9780141439512'
    expect(expandIdentifier(url)).toEqual({
      s: [url],
      i: ['isbn:9780141439512']
    })
    expect(expandIdentifier('9780141439512')).toEqual({ i: ['isbn:9780141439512'] })
  })

  it('expands wikidata URL and Q id', () => {
    const url = 'https://www.wikidata.org/wiki/Q6511'
    expect(expandIdentifier(url)).toEqual({
      s: [url],
      i: ['wikidata:Q6511']
    })
    expect(expandIdentifier('Q6511')).toEqual({ i: ['wikidata:Q6511'] })
  })

  it('keeps already-prefixed identifiers as i', () => {
    expect(expandIdentifier('wikipedia:en:Albert_Einstein')).toEqual({
      i: ['wikipedia:en:Albert_Einstein']
    })
    expect(expandIdentifier('gutenberg:1342')).toEqual({ i: ['gutenberg:1342'] })
  })

  it('normalizes www. URLs', () => {
    expect(expandIdentifier('www.gutenberg.org/ebooks/42')).toEqual({
      s: ['https://www.gutenberg.org/ebooks/42'],
      i: ['gutenberg:42']
    })
  })

  it('expands scheme-less gutenberg host to s and i', () => {
    expect(expandIdentifier('gutenberg.org/ebooks/1342')).toEqual({
      s: ['https://gutenberg.org/ebooks/1342'],
      i: ['gutenberg:1342']
    })
  })

  it('expands hyphenated ISBN to i', () => {
    expect(expandIdentifier('978-0141439512')).toEqual({ i: ['isbn:9780141439512'] })
  })
})
