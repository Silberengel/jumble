import { describe, expect, it } from 'vitest'
import { ExtendedKind } from '@/constants'
import {
  buildIndexByAddress,
  collectReachableAddresses,
  eventTagAddress,
  filterValidIndexEvents,
  getTopLevelIndexEvents
} from '@/lib/publication-index'
import type { Event } from 'nostr-tools'

const PK = 'a'.repeat(64)

function indexEvent(d: string, aTags: string[], id = d.padEnd(64, '0').slice(0, 64)): Event {
  return {
    id,
    kind: ExtendedKind.PUBLICATION,
    pubkey: PK,
    created_at: 100,
    content: '',
    tags: [['d', d], ['title', `Title ${d}`], ...aTags.map((a) => ['a', a] as [string, string])],
    sig: 'c'.repeat(128)
  }
}

function contentEvent(d: string, id = d.padEnd(64, '1').slice(0, 64)): Event {
  return {
    id,
    kind: ExtendedKind.PUBLICATION_CONTENT,
    pubkey: PK,
    created_at: 100,
    content: 'section body',
    tags: [['d', d], ['title', `Section ${d}`]],
    sig: 'd'.repeat(128)
  }
}

describe('publication-index', () => {
  it('filterValidIndexEvents rejects non-NKBIP-01 indexes', () => {
    const valid = indexEvent('book', [`30041:${PK}:chapter-1`])
    const withContent = { ...valid, content: 'not empty' }
    const noTitle = { ...valid, tags: [['d', 'book'], ['a', `30041:${PK}:chapter-1`]] }
    expect(filterValidIndexEvents([valid])).toHaveLength(1)
    expect(filterValidIndexEvents([withContent, noTitle])).toHaveLength(0)
  })

  it('getTopLevelIndexEvents excludes nested 30040 children', () => {
    const childAddr = `30040:${PK}:part-1`
    const root = indexEvent('book', [childAddr, `30041:${PK}:intro`])
    const child = indexEvent('part-1', [`30041:${PK}:chapter-1`], '2'.repeat(64))
    const top = getTopLevelIndexEvents([root, child])
    expect(top).toHaveLength(1)
    expect(eventTagAddress(top[0])).toBe(`30040:${PK}:book`)
  })

  it('collectReachableAddresses walks nested 30040 and 30041 refs', async () => {
    const childAddr = `30040:${PK}:part-1`
    const leafAddr = `30041:${PK}:chapter-1`
    const root = indexEvent('book', [childAddr, `30041:${PK}:intro`])
    const child = indexEvent('part-1', [leafAddr], '2'.repeat(64))
    const indexByAddress = buildIndexByAddress([root, child])

    const reachable = await collectReachableAddresses(
      root,
      indexByAddress,
      async () => null
    )

    expect(reachable.has(`30040:${PK}:book`)).toBe(true)
    expect(reachable.has(childAddr)).toBe(true)
    expect(reachable.has(`30041:${PK}:intro`)).toBe(true)
    expect(reachable.has(leafAddr)).toBe(true)
  })

  it('fetchMissingIndex resolves nested index not in initial cache', async () => {
    const childAddr = `30040:${PK}:part-1`
    const root = indexEvent('book', [childAddr])
    const child = indexEvent('part-1', [`30041:${PK}:chapter-1`], '2'.repeat(64))
    const indexByAddress = buildIndexByAddress([root])

    const reachable = await collectReachableAddresses(root, indexByAddress, async (addr) => {
      if (addr === childAddr) return child
      return null
    })

    expect(reachable.has(childAddr)).toBe(true)
    expect(reachable.has(`30041:${PK}:chapter-1`)).toBe(true)
    expect(indexByAddress.get(childAddr)?.id).toBe(child.id)
  })

  it('eventTagAddress uses lowercase pubkey', () => {
    const ev = contentEvent('section-a')
    expect(eventTagAddress(ev)).toBe(`30041:${PK}:section-a`)
  })
})
