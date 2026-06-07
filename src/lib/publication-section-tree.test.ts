import { describe, expect, it } from 'vitest'
import { ExtendedKind } from '@/constants'
import { orderedPublicationRefsFromIndex } from '@/lib/publication-asciidoc-assembler'
import {
  buildPublicationSectionTree,
  flattenPublicationSectionTreeForToc
} from '@/lib/publication-section-tree'
import type { Event } from 'nostr-tools'

const PK = 'a'.repeat(64)

function indexEvent(tags: string[][], id: string): Event {
  return {
    id,
    kind: ExtendedKind.PUBLICATION,
    pubkey: PK,
    created_at: 100,
    content: '',
    tags,
    sig: 'c'.repeat(128)
  }
}

function sectionEvent(d: string, title: string, id: string): Event {
  return {
    id,
    kind: ExtendedKind.PUBLICATION_CONTENT,
    pubkey: PK,
    created_at: 50,
    content: `Body of ${title}`,
    tags: [['d', d], ['title', title]],
    sig: 'd'.repeat(128)
  }
}

describe('buildPublicationSectionTree', () => {
  it('preserves a-tag order from each 30040 index', () => {
    const c1 = `30041:${PK}:chapter-1`
    const c2 = `30041:${PK}:chapter-2`
    const c3 = `30041:${PK}:chapter-3`
    const root = indexEvent(
      [
        ['d', 'book'],
        ['title', 'Book'],
        ['a', c3, '', 'Three'],
        ['t', 'ignored'],
        ['a', c1, '', 'One'],
        ['a', c2, '', 'Two']
      ],
      'root-id'
    )
    const ch1 = sectionEvent('chapter-1', 'Chapter One', 'ch1-id')
    const ch2 = sectionEvent('chapter-2', 'Chapter Two', 'ch2-id')
    const ch3 = sectionEvent('chapter-3', 'Chapter Three', 'ch3-id')
    const fetched = new Map<string, Event>([
      [c1, ch1],
      [c2, ch2],
      [c3, ch3]
    ])

    const tree = buildPublicationSectionTree(root, fetched)
    expect(tree.map((n) => n.title)).toEqual(['Chapter Three', 'Chapter One', 'Chapter Two'])
    expect(tree.map((n) => n.tagOrder)).toEqual([0, 1, 2])
  })

  it('keeps TOC and content traversal in the same order', () => {
    const part = `30040:${PK}:part-1`
    const c1 = `30041:${PK}:chapter-1`
    const c2 = `30041:${PK}:chapter-2`
    const root = indexEvent(
      [
        ['d', 'book'],
        ['title', 'Book'],
        ['a', part],
        ['a', c2],
        ['a', c1]
      ],
      'root-id'
    )
    const partIndex = indexEvent(
      [
        ['d', 'part-1'],
        ['title', 'Part One'],
        ['a', c1, '', 'First'],
        ['a', c2, '', 'Second']
      ],
      'part-id'
    )
    const ch1 = sectionEvent('chapter-1', 'Chapter One', 'ch1-id')
    const ch2 = sectionEvent('chapter-2', 'Chapter Two', 'ch2-id')
    const fetched = new Map<string, Event>([
      [part, partIndex],
      [c1, ch1],
      [c2, ch2]
    ])

    const tree = buildPublicationSectionTree(root, fetched)
    const toc = flattenPublicationSectionTreeForToc(tree)

    expect(toc.map((e) => e.title)).toEqual([
      'Part One',
      'Chapter One',
      'Chapter Two',
      'Chapter Two',
      'Chapter One'
    ])

    const contentOrder = (function walk(nodes: typeof tree): string[] {
      const titles: string[] = []
      for (const node of nodes) {
        titles.push(node.title)
        if (node.children.length > 0) titles.push(...walk(node.children))
      }
      return titles
    })(tree)

    expect(contentOrder).toEqual(toc.map((e) => e.title))
  })

  it('uppercases Roman numerals in section titles', () => {
    const c1 = `30041:${PK}:chapter-iii`
    const root = indexEvent(
      [
        ['d', 'book'],
        ['title', 'Book'],
        ['a', c1]
      ],
      'root-id'
    )
    const ch1 = sectionEvent('chapter-iii', 'Chapitre Iii', 'ch1-id')
    const fetched = new Map<string, Event>([[c1, ch1]])

    const tree = buildPublicationSectionTree(root, fetched)
    expect(tree[0]?.title).toBe('Chapitre III')
  })

  it('orderedPublicationRefsFromIndex assigns tagOrder in tag-list sequence', () => {
    const root = indexEvent(
      [
        ['d', 'book'],
        ['title', 'Book'],
        ['a', `30041:${PK}:b`],
        ['summary', 'x'],
        ['a', `30041:${PK}:a`],
        ['e', 'f'.repeat(64)]
      ],
      'root-id'
    )
    const refs = orderedPublicationRefsFromIndex(root)
    expect(refs.map((r) => r.tagOrder)).toEqual([0, 1, 2])
    expect(refs.map((r) => r.type)).toEqual(['a', 'a', 'e'])
  })
})
