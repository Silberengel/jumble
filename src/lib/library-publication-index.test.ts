import { describe, expect, it } from 'vitest'
import { ExtendedKind } from '@/constants'
import {
  buildEngagementMapsFromEvents,
  filterEngagedPublications,
  filterLibraryPublicationsBySearch
} from '@/lib/library-publication-index'
import { buildIndexByAddress } from '@/lib/publication-index'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'

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

describe('library-publication-index', () => {
  it('matches engagement on nested 30041 addresses', async () => {
    const leafAddr = `30041:${PK}:chapter-1`
    const childAddr = `30040:${PK}:part-1`
    const root = indexEvent('book', [childAddr])
    const child = indexEvent('part-1', [leafAddr], '2'.repeat(64))
    const indexByAddress = buildIndexByAddress([root, child])

    const highlight: Event = {
      id: '3'.repeat(64),
      kind: kinds.Highlights,
      pubkey: 'f'.repeat(64),
      created_at: 50,
      content: 'highlighted text',
      tags: [['a', leafAddr]],
      sig: 'e'.repeat(128)
    }

    const engagement = buildEngagementMapsFromEvents([], [], [highlight])
    const engaged = await filterEngagedPublications([root], indexByAddress, engagement, [])

    expect(engaged).toHaveLength(1)
    expect(engaged[0].hasHighlight).toBe(true)
    expect(engaged[0].hasLabel).toBe(false)
  })

  it('matches labels by root event id', async () => {
    const root = indexEvent('book', [`30041:${PK}:intro`])
    const indexByAddress = buildIndexByAddress([root])
    const label: Event = {
      id: '4'.repeat(64),
      kind: ExtendedKind.LABEL,
      pubkey: 'f'.repeat(64),
      created_at: 50,
      content: '',
      tags: [['L', 'license'], ['l', 'MIT', 'license'], ['e', root.id]],
      sig: 'e'.repeat(128)
    }
    const engagement = buildEngagementMapsFromEvents([label], [], [])
    const engaged = await filterEngagedPublications([root], indexByAddress, engagement, [])
    expect(engaged).toHaveLength(1)
    expect(engaged[0].hasLabel).toBe(true)
  })

  it('filterLibraryPublicationsBySearch matches title', () => {
    const root = indexEvent('book', [`30041:${PK}:intro`])
    const entries = [
      {
        event: root,
        hasLabel: true,
        hasComment: false,
        hasHighlight: false,
        engagementCount: 1
      }
    ]
    expect(filterLibraryPublicationsBySearch(entries, 'title book')).toHaveLength(1)
    expect(filterLibraryPublicationsBySearch(entries, 'missing')).toHaveLength(0)
  })
})
