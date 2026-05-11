import { describe, expect, it } from 'vitest'
import { mapNoteListSubRequestsForTimeline } from './note-list-requests'

describe('mapNoteListSubRequestsForTimeline', () => {
  it('adds default kinds and timeline limits for normal feeds', () => {
    const [request] = mapNoteListSubRequestsForTimeline(
      [{ urls: ['wss://relay.example/'], filter: { authors: ['alice'] } }],
      {
        defaultKinds: [1],
        seeAllFeedEvents: false,
        useFilterAsIs: false,
        areAlgoRelays: false,
        allowKindlessRelayExplore: false,
        clientSideKindFilter: false,
        limit: 150,
        algoLimit: 200,
        relayExploreLimit: 120
      }
    )

    expect(request.filter).toEqual({ authors: ['alice'], kinds: [1], limit: 150 })
  })

  it('keeps kindless single-relay exploration kindless', () => {
    const [request] = mapNoteListSubRequestsForTimeline(
      [{ urls: ['wss://relay.example/'], filter: {} }],
      {
        defaultKinds: [1],
        seeAllFeedEvents: false,
        useFilterAsIs: true,
        areAlgoRelays: false,
        allowKindlessRelayExplore: true,
        clientSideKindFilter: false,
        limit: 150,
        algoLimit: 200,
        relayExploreLimit: 120
      }
    )

    expect(request.filter).toEqual({ limit: 120 })
  })

  it('removes server-side kind filters for see-all feeds', () => {
    const [request] = mapNoteListSubRequestsForTimeline(
      [{ urls: ['wss://relay.example/'], filter: { kinds: [1], limit: 10 } }],
      {
        defaultKinds: [1],
        seeAllFeedEvents: true,
        useFilterAsIs: false,
        areAlgoRelays: false,
        allowKindlessRelayExplore: false,
        clientSideKindFilter: false,
        limit: 150,
        algoLimit: 200,
        relayExploreLimit: 120
      }
    )

    expect(request.filter).toEqual({ limit: 150 })
  })
})
