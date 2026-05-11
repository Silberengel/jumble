import { describe, expect, it } from 'vitest'
import { homeFeedDescriptor } from './adapters'
import { buildFeedDiagnosticsSnapshot } from './diagnostics'
import type { FeedRuntimeSnapshot } from './runtime'

describe('buildFeedDiagnosticsSnapshot', () => {
  it('includes relay policy, empty-state, and pagination diagnostics', () => {
    const descriptor = homeFeedDescriptor([
      { urls: ['wss://relay.example/'], filter: { kinds: [1], limit: 20 } }
    ])
    const runtime: FeedRuntimeSnapshot = {
      generation: 1,
      status: 'ready',
      rows: [],
      stale: false,
      rawCount: 2,
      visibleCount: 1,
      hiddenCount: 1,
      relayOutcomes: [{ relayUrl: 'wss://relay.example/', status: 'event', eventCount: 2 }],
      emptyReason: 'not-empty',
      hasMore: true,
      paginationStatus: 'idle',
      nextCursor: 10
    }

    const snapshot = buildFeedDiagnosticsSnapshot({
      descriptor,
      relayPolicy: {
        urls: ['wss://relay.example/'],
        dropped: [{ url: 'bad', normalizedUrl: 'bad', source: 'fallback', reason: 'invalid' }]
      },
      runtime
    })

    expect(snapshot.surface).toBe('home')
    expect(snapshot.relayUrls).toEqual(['wss://relay.example/'])
    expect(snapshot.droppedRelays[0].reason).toBe('invalid')
    expect(snapshot.runtime.paginationStatus).toBe('idle')
    expect(snapshot.runtime.nextCursor).toBe(10)
  })
})
