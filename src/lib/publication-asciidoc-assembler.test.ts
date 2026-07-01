import { describe, expect, it } from 'vitest'
import { ExtendedKind } from '@/constants'
import { assemblePublicationAsciidoc, orderedPublicationRefsFromIndex } from '@/lib/publication-asciidoc-assembler'
import { collectPublicationIndexRelayHints } from '@/lib/publication-section-fetch'
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
    expect(assembled.content).toContain(':allow-uri-read:')
    // Real cover (thumbnail / PDF cover page) plus a centered EPUB title page (HTML passthrough).
    expect(assembled.content).toContain(':front-cover-image: image:https://example.com/cover.jpg[]')
    expect(assembled.content).toContain('ifdef::backend-epub3[]')
    expect(assembled.content).toContain('image::https://example.com/cover.jpg[Cover,250]')
    expect(assembled.content).toContain('by Jane Author (writer)')
    expect(assembled.content).toContain('Edition:') // metadata row label
    expect(assembled.content).toContain('1.2')
    expect(assembled.content).toContain('[abstract]')
    expect(assembled.content).toContain('A short summary.')
    expect(assembled.content).toContain('== Introduction')
    expect(assembled.content).toContain('Hello world.')
  })
})

describe('orderedPublicationRefsFromIndex', () => {
  it('includes lowercase e-tag refs and ignores uppercase E source-event tag', () => {
    const event: Event = {
      id: '1'.repeat(64),
      kind: ExtendedKind.PUBLICATION,
      pubkey: PK,
      created_at: 100,
      content: '',
      tags: [
        ['d', 'book'],
        ['title', 'Book'],
        ['e', 'aa'.repeat(32)],
        ['e', 'bb'.repeat(32)],
        ['E', 'cc'.repeat(32), 'wss://relay.example', PK]
      ],
      sig: 'c'.repeat(128)
    }
    const refs = orderedPublicationRefsFromIndex(event)
    expect(refs).toHaveLength(2)
    expect(refs.every((ref) => ref.type === 'e')).toBe(true)
    expect(refs.map((ref) => ref.eventId)).toEqual(['aa'.repeat(32), 'bb'.repeat(32)])
  })

  it('collectPublicationIndexRelayHints uses the source-event E tag relay', () => {
    const event: Event = {
      id: '1'.repeat(64),
      kind: ExtendedKind.PUBLICATION,
      pubkey: PK,
      created_at: 100,
      content: '',
      tags: [
        ['d', 'book'],
        ['title', 'Book'],
        ['e', 'aa'.repeat(32)],
        ['E', 'cc'.repeat(32), 'wss://thecitadel.nostr1.com', PK]
      ],
      sig: 'c'.repeat(128)
    }
    const refs = orderedPublicationRefsFromIndex(event)
    const hints = collectPublicationIndexRelayHints(event, refs)
    expect(hints).toHaveLength(1)
    expect(hints[0]).toContain('thecitadel.nostr1.com')
  })
})
