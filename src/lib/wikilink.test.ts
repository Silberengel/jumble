import { describe, expect, it } from 'vitest'
import { parseContent, PARSE_CONTENT_PARSERS_NOTE_TEXT } from '@/lib/content-parser'
import { parseWikilinkInner, wikilinkTargetToDTag } from '@/lib/wikilink'

describe('wikilink helpers', () => {
  it('slugifies a target into a d-tag', () => {
    expect(wikilinkTargetToDTag('April')).toBe('april')
    expect(wikilinkTargetToDTag('Bitcoin Wallet')).toBe('bitcoin-wallet')
    expect(wikilinkTargetToDTag('  Hello, World!  ')).toBe('hello-world')
  })

  it('preserves non-ASCII letters/numbers per NIP-54', () => {
    // Japanese is preserved verbatim
    expect(wikilinkTargetToDTag('ウィキペディア')).toBe('ウィキペディア')
    // mixed scripts: whitespace → '-', punctuation removed, letters kept
    expect(wikilinkTargetToDTag('日本語 Article!')).toBe('日本語-article')
    // accented letters are lowercased but not stripped
    expect(wikilinkTargetToDTag('Ñoño')).toBe('ñoño')
    expect(wikilinkTargetToDTag('Article 1')).toBe('article-1')
    expect(wikilinkTargetToDTag('NKBIP-01')).toBe('nkbip-01')
  })

  it('parses plain and aliased inner content', () => {
    expect(parseWikilinkInner('April')).toEqual({ dTag: 'april', displayText: 'April' })
    expect(parseWikilinkInner('April|Spring')).toEqual({ dTag: 'april', displayText: 'Spring' })
    expect(parseWikilinkInner(' Bitcoin Wallet | My wallet ')).toEqual({
      dTag: 'bitcoin-wallet',
      displayText: 'My wallet'
    })
  })

  it('handles the documented wikilink forms', () => {
    // [[Target Page]] -> links to target-page, displays as "Target Page"
    expect(parseWikilinkInner('Target Page')).toEqual({
      dTag: 'target-page',
      displayText: 'Target Page'
    })
    // [[target page|see this]] -> links to target-page, displays as "see this"
    expect(parseWikilinkInner('target page|see this')).toEqual({
      dTag: 'target-page',
      displayText: 'see this'
    })
  })
})

describe('note-text content parser wikilinks', () => {
  it('extracts an inline wikilink within a sentence', () => {
    const nodes = parseContent(
      'encase any term in double-brackets, like [[April]] and clicking that',
      PARSE_CONTENT_PARSERS_NOTE_TEXT
    )
    const wiki = nodes.find((n) => n.type === 'wikilink')
    expect(wiki).toBeDefined()
    expect(wiki?.data).toBe('April')
  })

  it('does not treat citation markup as a wikilink', () => {
    const nodes = parseContent('see [[citation::nevent1abc]] here', PARSE_CONTENT_PARSERS_NOTE_TEXT)
    expect(nodes.some((n) => n.type === 'wikilink')).toBe(false)
  })
})
