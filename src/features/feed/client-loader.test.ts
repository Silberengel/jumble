import { describe, expect, it } from 'vitest'
import { applyFeedCursorToRequests, createFetchEventsFeedRuntimeLoader, type FeedEventsClient } from './client-loader'
import type { Event, Filter } from 'nostr-tools'

function evt(id: string, created_at: number): Event {
  return {
    id,
    pubkey: `pubkey-${id}`,
    created_at,
    kind: 1,
    tags: [],
    content: '',
    sig: `sig-${id}`
  }
}

describe('feed client loader', () => {
  it('applies load-more cursors to request filters', () => {
    expect(
      applyFeedCursorToRequests(
        [{ urls: ['wss://relay.example/'], filter: { kinds: [1], until: 50, limit: 20 } }],
        40
      )[0].filter
    ).toEqual({ kinds: [1], until: 40, limit: 20 })
  })

  it('hydrates disk cache before relay reads and dedupes relay results', async () => {
    const calls: Array<{ urls: string[]; filter: Filter }> = []
    const client: FeedEventsClient = {
      getTimelineDiskSnapshotEvents: async () => [evt('cached', 30)],
      fetchEvents: async (urls, filter) => {
        calls.push({ urls, filter: filter as Filter })
        return [evt('relay-a', 20), evt('relay-a', 20), evt('relay-b', 10)]
      }
    }

    const loader = createFetchEventsFeedRuntimeLoader(client, {
      subRequests: [{ urls: ['wss://relay.example/'], filter: { kinds: [1], limit: 20 } }],
      hydrateFromDisk: true,
      cache: true
    })
    const result = await loader({
      descriptorKey: 'feed-a',
      generation: 1,
      refresh: false,
      page: 'initial',
      signal: new AbortController().signal
    })

    expect(result.cacheEvents?.map((event) => event.id)).toEqual(['cached'])
    expect(result.cacheStale).toBe(true)
    expect(result.relayEvents?.map((event) => event.id).sort()).toEqual(['relay-a', 'relay-b'])
    expect(result.hasMore).toBe(true)
    expect(calls).toHaveLength(1)
  })
})
