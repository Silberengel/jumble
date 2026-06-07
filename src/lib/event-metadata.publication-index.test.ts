import { describe, expect, it } from 'vitest'
import { ExtendedKind } from '@/constants'
import { getPublicationIndexMetadataFromEvent } from '@/lib/event-metadata'
import type { Event } from 'nostr-tools'

const PK = 'a'.repeat(64)

function indexEvent(tags: string[][]): Event {
  return {
    id: '1'.repeat(64),
    kind: ExtendedKind.PUBLICATION,
    pubkey: PK,
    created_at: 100,
    content: '',
    tags,
    sig: 'c'.repeat(128)
  }
}

describe('getPublicationIndexMetadataFromEvent', () => {
  it('extracts NKBIP-01 index tags', () => {
    const event = indexEvent([
      ['d', 'little-clay-cart'],
      ['title', 'The Little Clay Cart'],
      ['author', 'Sudraka', 'author'],
      ['author', 'Arthur W. Ryder', 'translator'],
      ['source', 'https://www.gutenberg.org/ebooks/21020'],
      ['l', 'en', 'ISO-639-1'],
      ['release_date', 'April 10, 2007'],
      ['type', 'book'],
      ['version', '1.0'],
      ['summary', 'A classic Sanskrit play.'],
      ['a', `30041:${PK}:chapter-1`, 'wss://relay.example', 'Chapter One'],
      ['a', `30041:${PK}:chapter-2`]
    ])

    const meta = getPublicationIndexMetadataFromEvent(event)

    expect(meta.title).toBe('The Little Clay Cart')
    expect(meta.authors).toEqual([
      { name: 'Sudraka', role: 'author' },
      { name: 'Arthur W. Ryder', role: 'translator' }
    ])
    expect(meta.source).toBe('https://www.gutenberg.org/ebooks/21020')
    expect(meta.image).toBe('https://www.gutenberg.org/cache/epub/21020/pg21020.cover.medium.jpg')
    expect(meta.language).toBe('en')
    expect(meta.releaseDate).toBe('April 10, 2007')
    expect(meta.type).toBe('book')
    expect(meta.version).toBe('1.0')
    expect(meta.summary).toBe('A classic Sanskrit play.')
    expect(meta.sectionCount).toBe(2)
    expect(meta.sections[0].label).toBe('Chapter One')
    expect(meta.sections[1].label).toBeUndefined()
  })

  it('falls back to d-tag title casing', () => {
    const event = indexEvent([['d', 'village-life-in-china'], ['a', `30041:${PK}:intro`]])
    const meta = getPublicationIndexMetadataFromEvent(event)
    expect(meta.title).toBe('Village Life In China')
    expect(meta.sectionCount).toBe(1)
  })

  it('uses Project Gutenberg cover when source is gutenberg and image tag is missing', () => {
    const event = indexEvent([
      ['d', 'pg58363-sketches-of-indian-character'],
      ['title', 'Sketches of Indian Character'],
      ['author', 'James Napier Bailey', 'author'],
      ['source', 'https://www.gutenberg.org/ebooks/58363'],
      ['a', `30041:${PK}:intro`]
    ])
    const meta = getPublicationIndexMetadataFromEvent(event)
    expect(meta.image).toBe(
      'https://www.gutenberg.org/cache/epub/58363/pg58363.cover.medium.jpg'
    )
  })

  it('keeps explicit image tag over Gutenberg fallback', () => {
    const event = indexEvent([
      ['d', 'book'],
      ['title', 'Book'],
      ['source', 'https://www.gutenberg.org/ebooks/58363'],
      ['image', 'https://example.com/cover.jpg'],
      ['a', `30041:${PK}:intro`]
    ])
    const meta = getPublicationIndexMetadataFromEvent(event)
    expect(meta.image).toBe('https://example.com/cover.jpg')
  })

  it('normalizes Gutenberg ebook page in image tag to cover JPG', () => {
    const event = indexEvent([
      ['d', 'book'],
      ['title', 'Book'],
      ['image', 'https://www.gutenberg.org/ebooks/16702'],
      ['a', `30041:${PK}:intro`]
    ])
    const meta = getPublicationIndexMetadataFromEvent(event)
    expect(meta.image).toBe('https://www.gutenberg.org/cache/epub/16702/pg16702.cover.medium.jpg')
  })
})
