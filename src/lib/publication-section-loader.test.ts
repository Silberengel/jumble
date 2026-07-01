import { describe, expect, it } from 'vitest'
import { ExtendedKind } from '@/constants'
import { collectPendingPublicationSectionLoads, countPublicationSectionLoadProgress } from '@/lib/publication-section-loader'
import { publicationRefKey } from '@/lib/publication-section-fetch'
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
      tags: [['d', d], ['title', d], ...aTags.map((a) => ['a', a] as [string, string])]
    },
    sk
  )
}

function contentEvent(d: string): Event {
  return finalizeEvent(
    {
      kind: ExtendedKind.PUBLICATION_CONTENT,
      created_at: 100,
      content: 'body',
      tags: [['d', d], ['title', d]]
    },
    sk
  )
}

describe('publication-section-loader', () => {
  it('collectPendingPublicationSectionLoads walks nested indexes in tag order', () => {
    const s1 = `30041:${PK}:s1`
    const s2 = `30041:${PK}:s2`
    const childAddr = `30040:${PK}:part`
    const root = indexEvent('book', [s1, childAddr, s2])
    const fetched = new Map<string, Event>([
      [root.id, root],
      [publicationRefKey({ type: 'a', coordinate: s1 })!, contentEvent('s1')]
    ])
    const failed = new Set<string>()
    const inFlight = new Set<string>()

    const pending = collectPendingPublicationSectionLoads(root, fetched, failed, inFlight)
    expect(pending.map((task) => publicationRefKey(task.ref))).toEqual([childAddr, s2])
  })

  it('countPublicationSectionLoadProgress counts resolved and pending refs', () => {
    const s1 = `30041:${PK}:s1`
    const s2 = `30041:${PK}:s2`
    const root = indexEvent('book', [s1, s2])
    const fetched = new Map<string, Event>([
      [root.id, root],
      [publicationRefKey({ type: 'a', coordinate: s1 })!, contentEvent('s1')]
    ])
    const failed = new Set<string>()

    expect(countPublicationSectionLoadProgress(root, fetched, failed)).toEqual({
      resolved: 1,
      pending: 1
    })
  })
})
