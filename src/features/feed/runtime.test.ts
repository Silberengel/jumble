import { describe, expect, it } from 'vitest'
import { FeedRuntime, feedRuntimeReducer, createInitialFeedRuntimeState } from './runtime'
import type { Event } from 'nostr-tools'

function evt(id: string, created_at: number, kind = 1): Event {
  return {
    id,
    pubkey: `pubkey-${id}`,
    created_at,
    kind,
    tags: [],
    content: '',
    sig: `sig-${id}`
  }
}

describe('feedRuntimeReducer', () => {
  it('marks cached rows stale during refresh until relay rows arrive', () => {
    let state = createInitialFeedRuntimeState('feed-a')
    state = feedRuntimeReducer(state, { type: 'cache', events: [evt('a', 10)], stale: true })
    expect(state.stale).toBe(true)
    expect(state.emptyReason).toBe('stale-cache-only')

    state = feedRuntimeReducer(state, {
      type: 'relayBatch',
      events: [evt('b', 11)],
      relayOutcomes: [{ relayUrl: 'wss://relay.example/', status: 'event', eventCount: 1 }]
    })
    state = feedRuntimeReducer(state, { type: 'relayDone' })

    expect(state.stale).toBe(false)
    expect(state.status).toBe('ready')
    expect(state.rows.map((row) => row.id)).toEqual(['b', 'a'])
  })

  it('reports visible-vs-raw empty states', () => {
    const state = feedRuntimeReducer(
      createInitialFeedRuntimeState('feed-a'),
      { type: 'relayBatch', events: [evt('zap', 10, 9735)] },
      { isVisibleEvent: (event) => event.kind === 1 }
    )

    expect(state.rawCount).toBe(1)
    expect(state.visibleCount).toBe(0)
    expect(state.hiddenCount).toBe(1)
    expect(state.emptyReason).toBe('no-visible-events')
  })
})

describe('FeedRuntime', () => {
  it('keeps old rows stale during manual refresh and replaces them with fresh relay rows', async () => {
    const runtime = new FeedRuntime({ descriptorKey: 'feed-a' })
    await runtime.load(async () => ({
      relayEvents: [evt('old', 10)],
      relayOutcomes: [{ relayUrl: 'wss://relay.example/', status: 'event', eventCount: 1 }]
    }))

    const refreshed = await runtime.load(
      async () => ({
        cacheEvents: [evt('old', 10)],
        cacheStale: true,
        relayEvents: [evt('new', 20)],
        relayOutcomes: [{ relayUrl: 'wss://relay.example/', status: 'event', eventCount: 1 }]
      }),
      true
    )

    expect(refreshed.stale).toBe(false)
    expect(refreshed.rows.map((row) => row.id)).toEqual(['new', 'old'])
    expect(refreshed.generation).toBe(2)
  })

  it('loads older pages with the cursor from the previous batch', async () => {
    const runtime = new FeedRuntime({ descriptorKey: 'feed-a' })
    const first = await runtime.load(async ({ page }) => {
      expect(page).toBe('initial')
      return {
        relayEvents: [evt('new', 20), evt('middle', 10)],
        hasMore: true
      }
    })

    expect(first.hasMore).toBe(true)
    expect(first.nextCursor).toBe(9)

    const next = await runtime.loadMore(async ({ page, cursor }) => {
      expect(page).toBe('load-more')
      expect(cursor).toBe(9)
      return {
        relayEvents: [evt('old', 5)],
        hasMore: false
      }
    })

    expect(next.rows.map((row) => row.id)).toEqual(['new', 'middle', 'old'])
    expect(next.paginationStatus).toBe('exhausted')
    expect(next.hasMore).toBe(false)
  })

  it('can seed existing rows before loading an older page', async () => {
    const runtime = new FeedRuntime({ descriptorKey: 'feed-a' })
    runtime.seed([evt('new', 20)], { hasMore: true, nextCursor: 19 })

    const next = await runtime.loadMore(async ({ cursor }) => {
      expect(cursor).toBe(19)
      return {
        relayEvents: [evt('old', 10)],
        hasMore: true
      }
    })

    expect(next.rows.map((row) => row.id)).toEqual(['new', 'old'])
    expect(next.paginationStatus).toBe('idle')
  })
})
