import { describe, expect, it } from 'vitest'
import { ExtendedKind } from '@/constants'
import { kinds } from 'nostr-tools'
import { isAsciidocPublicationSectionKind } from '@/lib/publication-section-content-kind'

describe('isAsciidocPublicationSectionKind', () => {
  it('uses AsciiDoc for publication content and wiki articles', () => {
    expect(isAsciidocPublicationSectionKind(ExtendedKind.PUBLICATION_CONTENT)).toBe(true)
    expect(isAsciidocPublicationSectionKind(ExtendedKind.WIKI_ARTICLE)).toBe(true)
  })

  it('uses Markdown for other publication section kinds', () => {
    expect(isAsciidocPublicationSectionKind(ExtendedKind.NOSTR_SPECIFICATION)).toBe(false)
    expect(isAsciidocPublicationSectionKind(kinds.LongFormArticle)).toBe(false)
  })
})
