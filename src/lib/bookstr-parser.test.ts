import { describe, expect, it } from 'vitest'
import { ExtendedKind } from '@/constants'
import { isNkbip08BookstrEvent } from '@/lib/bookstr-parser'
import type { Event } from 'nostr-tools'

const PK = '73d8a0c3739c00a8802ee6f5abe0ee330d879e2bd18336ecca38a205c1853717'

function publicationSectionEvent(): Event {
  return {
    id: 'ac3457dfdd7ed82736fcd3b9b3b076ea6042a4dc2bb5d613e84b24dd305e42bd',
    pubkey: PK,
    created_at: 1769364028,
    kind: ExtendedKind.PUBLICATION_CONTENT,
    tags: [
      ['d', 'redacted-science-section-1'],
      ['title', 'Redacted Science'],
      ['L', 'en'],
      ['m', 'text/asciidoc'],
      ['type', 'book'],
      ['C', 'redacted-science'],
      ['T', 'redacted-science'],
      ['s', 'redacted-science']
    ],
    content: 'Section body',
    sig: 'sig'
  }
}

describe('isNkbip08BookstrEvent', () => {
  it('returns false for NKBIP-01 publication index', () => {
    const index: Event = {
      id: 'idx',
      pubkey: PK,
      created_at: 1,
      kind: ExtendedKind.PUBLICATION,
      tags: [['d', 'book'], ['T', 'genesis']],
      content: '',
      sig: 'sig'
    }
    expect(isNkbip08BookstrEvent(index)).toBe(false)
  })

  it('returns false for NKBIP-01 publication section with type book', () => {
    expect(isNkbip08BookstrEvent(publicationSectionEvent())).toBe(false)
  })

  it('returns true for bookstr wikilink content without type book', () => {
    const event = publicationSectionEvent()
    event.tags = event.tags.filter((tag) => tag[0] !== 'type')
    event.content = 'See [[book::bible | genesis 1:1 | kjv]]'
    expect(isNkbip08BookstrEvent(event)).toBe(true)
  })
})
