import { describe, expect, it } from 'vitest'
import { ExtendedKind } from '@/constants'
import {
  buildIndexByAddress,
  buildPublicationIndexMap,
  collectReachableAddresses,
  collectReachableAddressesCached,
  eventTagAddress,
  filterValidIndexEvents,
  getTopLevelIndexEvents,
  pickNewerPublicationIndexEvent,
  publicationIndexMapValues
} from '@/lib/publication-index'
import type { Event } from 'nostr-tools'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'

const sk = generateSecretKey()
const PK = getPublicKey(sk)

function indexEvent(d: string, aTags: string[]): Event {
  return finalizeEvent(
    {
      kind: ExtendedKind.PUBLICATION,
      created_at: 100,
      content: '',
      tags: [['d', d], ['title', `Title ${d}`], ...aTags.map((a) => ['a', a] as [string, string])]
    },
    sk
  )
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
    const nullContent = { ...valid, content: null as unknown as string }
    expect(filterValidIndexEvents([valid])).toHaveLength(1)
    expect(filterValidIndexEvents([nullContent])).toHaveLength(1)
    expect(filterValidIndexEvents([withContent, noTitle])).toHaveLength(0)
  })

  it('filterValidIndexEvents accepts catalog cards with no section refs', () => {
    const catalogOnly = finalizeEvent(
      {
        kind: ExtendedKind.PUBLICATION,
        created_at: 100,
        content: '',
        tags: [
          ['d', 'opa-ol1w-stub'],
          ['title', 'Catalog Stub'],
          ['summary', 'A short blurb for the card.']
        ]
      },
      sk
    )
    expect(filterValidIndexEvents([catalogOnly])).toHaveLength(1)
  })

  it('getTopLevelIndexEvents excludes nested 30040 children', () => {
    const childAddr = `30040:${PK}:part-1`
    const root = indexEvent('book', [childAddr, `30041:${PK}:intro`])
    const child = indexEvent('part-1', [`30041:${PK}:chapter-1`])
    const top = getTopLevelIndexEvents([root, child])
    expect(top).toHaveLength(1)
    expect(eventTagAddress(top[0])).toBe(`30040:${PK}:book`)
  })

  it('collectReachableAddressesCached walks nested 30040 and 30041 refs', () => {
    const childAddr = `30040:${PK}:part-1`
    const leafAddr = `30041:${PK}:chapter-1`
    const root = indexEvent('book', [childAddr, `30041:${PK}:intro`])
    const child = indexEvent('part-1', [leafAddr])
    const indexByAddress = buildIndexByAddress([root, child])

    const reachable = collectReachableAddressesCached(root, indexByAddress)

    expect(reachable.has(`30040:${PK}:book`)).toBe(true)
    expect(reachable.has(childAddr)).toBe(true)
    expect(reachable.has(`30041:${PK}:intro`)).toBe(true)
    expect(reachable.has(leafAddr)).toBe(true)
  })

  it('fetchMissingIndex resolves nested index not in initial cache', async () => {
    const childAddr = `30040:${PK}:part-1`
    const root = indexEvent('book', [childAddr])
    const child = indexEvent('part-1', [`30041:${PK}:chapter-1`])
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

  it('buildPublicationIndexMap keeps newest valid row per kind:pubkey:d', () => {
    const older = indexEvent('same-book', [`30041:${PK}:intro`])
    older.created_at = 10
    const newer = finalizeEvent(
      {
        kind: ExtendedKind.PUBLICATION,
        created_at: 20,
        content: '',
        tags: [
          ['d', 'same-book'],
          ['title', 'Revised title'],
          ['a', `30041:${PK}:intro`]
        ]
      },
      sk
    )
    const invalid = { ...older, content: 'not empty' }

    const map = buildPublicationIndexMap([older, newer, invalid])
    expect(publicationIndexMapValues(map)).toHaveLength(1)
    expect(map.get(`30040:${PK}:same-book`)?.id).toBe(newer.id)
    expect(getTopLevelIndexEvents([older, newer, invalid])).toHaveLength(1)
    expect(getTopLevelIndexEvents([older, newer, invalid])[0].id).toBe(newer.id)
  })

  it('pickNewerPublicationIndexEvent breaks created_at ties by event id', () => {
    const first = finalizeEvent(
      {
        kind: ExtendedKind.PUBLICATION,
        created_at: 50,
        content: '',
        tags: [['d', 'tie-book'], ['title', 'First'], ['a', `30041:${PK}:a`]]
      },
      sk
    )
    const second = finalizeEvent(
      {
        kind: ExtendedKind.PUBLICATION,
        created_at: 50,
        content: '',
        tags: [['d', 'tie-book'], ['title', 'Second'], ['a', `30041:${PK}:b`]]
      },
      sk
    )
    const chosen = pickNewerPublicationIndexEvent(first, second)
    expect(chosen.id).toBe(first.id > second.id ? first.id : second.id)
  })
})
