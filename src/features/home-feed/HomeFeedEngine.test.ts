import { describe, expect, it, vi } from 'vitest'
import { HomeFeedEngine } from './HomeFeedEngine'
import type { HomeFeedDescriptorBundle } from './buildHomeFeedDescriptor'
import { createFeedDescriptor } from '@/features/feed/descriptor'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'

vi.mock('@/services/indexed-db.service', () => ({
  default: {
    scanEventArchiveByKinds: vi.fn(async () => [])
  }
}))

function mockBundle(): HomeFeedDescriptorBundle {
  const descriptor = createFeedDescriptor({
    surface: 'home',
    id: 'favorites',
    requests: [{ urls: ['wss://r.example.com'], filter: { kinds: [1], limit: 150 } }],
    source: { publicReadFallback: true, preserveRowsOnRelayChange: true }
  })
  return {
    descriptor,
    sinceScopeKey: 'all-favorites',
    subscriptionKey: 'home-all-favorites',
    relaySetFeedOnly: false,
    notesSubRequests: [{ urls: ['wss://r.example.com'], filter: { kinds: [1] } }],
    repliesSubRequests: [{ urls: ['wss://r.example.com'], filter: { kinds: [1] } }],
    activeSubRequests: [{ urls: ['wss://r.example.com'], filter: { kinds: [1], limit: 150 } }],
    seenOnAllowlistOp: ['wss://r.example.com'],
    seenOnAllowlistReplies: ['wss://r.example.com']
  }
}

function evt(id: string): Event {
  return {
    id,
    pubkey: 'aa'.repeat(32),
    created_at: 1_700_000_000,
    kind: kinds.ShortTextNote,
    tags: [],
    content: 'x',
    sig: 's'
  }
}

describe('HomeFeedEngine', () => {
  it('merges live subscribe events and clears loading', async () => {
    const changes: number[] = []
    let onEvents: ((events: Event[], eosed: boolean) => void) | undefined
    const client = {
      subscribeTimeline: vi.fn(async (_reqs, cbs) => {
        onEvents = cbs.onEvents
        return { closer: vi.fn(), timelineKey: 'tk-1' }
      }),
      fetchEvents: vi.fn(async () => []),
      loadMoreTimeline: vi.fn(async () => [])
    }

    const engine = new HomeFeedEngine({
      client,
      bundle: mockBundle(),
      sessionSnapshotKey: 'snap',
      onChange: () => changes.push(1)
    })

    const startPromise = engine.start(false)
    await vi.waitFor(() => {
      expect(onEvents).toBeDefined()
    })
    onEvents?.([evt('e1')], false)
    await startPromise

    expect(engine.getSnapshot().rawEvents.some((e) => e.id === 'e1')).toBe(true)
    expect(engine.getSnapshot().loading).toBe(false)
    expect(engine.getSnapshot().emptyUiReady).toBe(true)
  })

  it('coalesces rapid onNew emits into one merge flush', async () => {
    let onNew: ((evt: Event) => void) | undefined
    let changeCount = 0
    const client = {
      subscribeTimeline: vi.fn(async (_reqs, cbs) => {
        onNew = cbs.onNew
        return { closer: vi.fn(), timelineKey: 'tk-1' }
      }),
      fetchEvents: vi.fn(async () => []),
      loadMoreTimeline: vi.fn(async () => [])
    }

    const engine = new HomeFeedEngine({
      client,
      bundle: mockBundle(),
      sessionSnapshotKey: 'snap',
      onChange: () => {
        changeCount += 1
      }
    })

    const startPromise = engine.start(false)
    await vi.waitFor(() => {
      expect(onNew).toBeDefined()
    })
    await startPromise
    const afterStartChanges = changeCount

    vi.useFakeTimers()
    onNew?.(evt('live-1'))
    onNew?.(evt('live-2'))
    onNew?.(evt('live-3'))
    expect(engine.getSnapshot().rawEvents.some((e) => e.id === 'live-1')).toBe(false)
    await vi.advanceTimersByTimeAsync(80)
    vi.useRealTimers()

    expect(engine.getSnapshot().rawEvents.filter((e) => e.id.startsWith('live-')).length).toBe(3)
    expect(changeCount - afterStartChanges).toBeGreaterThanOrEqual(1)
    expect(changeCount - afterStartChanges).toBeLessThanOrEqual(2)
  })

  it('passes connectionSlotPriority on subscribeTimeline', async () => {
    const client = {
      subscribeTimeline: vi.fn(async () => ({
        closer: vi.fn(),
        timelineKey: 'tk-1'
      })),
      fetchEvents: vi.fn(async () => []),
      loadMoreTimeline: vi.fn(async () => [])
    }

    const engine = new HomeFeedEngine({
      client,
      bundle: mockBundle(),
      sessionSnapshotKey: 'snap',
      onChange: () => {}
    })

    await engine.start(false)
    expect(client.subscribeTimeline).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Object),
      expect.objectContaining({ connectionSlotPriority: true })
    )
  })

  it('refresh clears persisted since path via skip flag', async () => {
    const client = {
      subscribeTimeline: vi.fn(async () => ({
        closer: vi.fn(),
        timelineKey: 'tk-1'
      })),
      fetchEvents: vi.fn(async () => []),
      loadMoreTimeline: vi.fn(async () => [])
    }

    const engine = new HomeFeedEngine({
      client,
      bundle: mockBundle(),
      sessionSnapshotKey: 'snap',
      onChange: () => {}
    })

    await engine.start(true)
    expect(client.subscribeTimeline).toHaveBeenCalled()
  })

  it('primes from local feed stores before subscribe', async () => {
    let subscribed = false
    const client = {
      getLocalFeedEvents: vi.fn(async () => [evt('local-1')]),
      subscribeTimeline: vi.fn(async () => {
        subscribed = true
        return { closer: vi.fn(), timelineKey: 'tk-1' }
      }),
      fetchEvents: vi.fn(async () => []),
      loadMoreTimeline: vi.fn(async () => [])
    }

    const engine = new HomeFeedEngine({
      client,
      bundle: mockBundle(),
      sessionSnapshotKey: 'snap',
      onChange: () => {}
    })

    await engine.start(false)
    expect(client.getLocalFeedEvents).toHaveBeenCalled()
    expect(subscribed).toBe(true)
    expect(engine.getSnapshot().rawEvents.some((e) => e.id === 'local-1')).toBe(true)
  })
})
