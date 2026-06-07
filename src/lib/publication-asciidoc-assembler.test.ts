import { describe, expect, it } from 'vitest'
import { ExtendedKind } from '@/constants'
import { assemblePublicationAsciidoc } from '@/lib/publication-asciidoc-assembler'
import type { Event } from 'nostr-tools'

const PK = 'a'.repeat(64)

function indexEvent(d: string, aTags: string[], id = d.padEnd(64, '0').slice(0, 64)): Event {
  return {
    id,
    kind: ExtendedKind.PUBLICATION,
    pubkey: PK,
    created_at: 100,
    content: '',
    tags: [
      ['d', d],
      ['title', `Book ${d}`],
      ['author', 'Jane Author', 'writer'],
      ['image', 'https://example.com/cover.jpg'],
      ['version', '1.2'],
      ['summary', 'A short summary.'],
      ...aTags.map((a) => ['a', a] as [string, string])
    ],
    sig: 'c'.repeat(128)
  }
}

function sectionEvent(d: string, title: string, content: string): Event {
  return {
    id: `${d}-id`.padEnd(64, '0').slice(0, 64),
    kind: ExtendedKind.PUBLICATION_CONTENT,
    pubkey: PK,
    created_at: 50,
    content,
    tags: [['d', d], ['title', title]],
    sig: 'd'.repeat(128)
  }
}

describe('assemblePublicationAsciidoc', () => {
  it('builds document header with cover and metadata', () => {
    const coord = `30041:${PK}:intro`
    const root = indexEvent('my-book', [coord])
    const intro = sectionEvent('intro', 'Introduction', 'Hello world.')
    const fetched = new Map<string, Event>([
      [root.id, root],
      [`30040:${PK}:my-book`, root],
      [coord, intro],
      [intro.id, intro]
    ])
    const byAddress = new Map<string, Event>([
      [`30040:${PK}:my-book`, root],
      [coord, intro]
    ])

    const assembled = assemblePublicationAsciidoc(root, fetched, byAddress)

    expect(assembled.title).toBe('Book my-book')
    expect(assembled.author).toBe('Jane Author (writer)')
    expect(assembled.image).toBe('https://example.com/cover.jpg')
    expect(assembled.content).toContain('= Book my-book')
    expect(assembled.content).toContain('Jane Author (writer)')
    expect(assembled.content).toContain(':doctype: book')
    expect(assembled.content).toContain(':epub-cover-image: https://example.com/cover.jpg')
    expect(assembled.content).toContain('[abstract]')
    expect(assembled.content).toContain('A short summary.')
    expect(assembled.content).toContain('== Introduction')
    expect(assembled.content).toContain('Hello world.')
  })
})
