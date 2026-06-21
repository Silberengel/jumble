import { describe, expect, it } from 'vitest'
import { filterRelayBatchForGeneralSearch } from '@/lib/general-search-relay-wave'
import type { Event } from 'nostr-tools'

function ev(partial: Partial<Event> & Pick<Event, 'kind' | 'content'>): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_700_000_000,
    sig: 'sig',
    tags: [],
    ...partial
  }
}

describe('filterRelayBatchForGeneralSearch', () => {
  it('matches title/summary tags without NIP-50', () => {
    const article = ev({
      kind: 30023,
      content: 'body text',
      tags: [
        ['title', 'Relay Article'],
        ['summary', 'A short intro']
      ]
    })
    const hits = filterRelayBatchForGeneralSearch([article], 'relay article', [30023])
    expect(hits).toHaveLength(1)
  })

  it('ignores non-matching relay rows', () => {
    const note = ev({ kind: 1, content: 'unrelated' })
    expect(filterRelayBatchForGeneralSearch([note], 'bitcoin', [1])).toHaveLength(0)
  })
})
