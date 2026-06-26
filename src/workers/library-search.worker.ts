/// <reference lib="webworker" />
import { scorePublicationContentEventSearchQuery } from '@/lib/general-search-scoring'
import type { Event } from 'nostr-tools'

/**
 * Library search scoring worker. Offloads the CPU-heavy kind-30041 content scoring (phrase/word matching
 * over potentially long passages) off the main thread so the Library UI stays responsive while a search
 * runs. The worker only imports `general-search-scoring` (pure, no DOM/network), so it bundles cleanly.
 *
 * Protocol: the client posts {@link LibrarySearchScoreRequest} and gets back {@link LibrarySearchScoreResponse}
 * with `[index, score]` pairs for events that scored > 0. Root resolution stays on the main thread (cheap
 * map lookups), keeping the serialized payload small.
 */
export type LibrarySearchScoreRequest = {
  id: number
  query: string
  events: Event[]
}

export type LibrarySearchScoreResponse = {
  id: number
  hits: Array<[number, number]>
}

const ctx = self as unknown as Worker

ctx.onmessage = (e: MessageEvent<LibrarySearchScoreRequest>) => {
  const { id, query, events } = e.data
  const hits: Array<[number, number]> = []
  for (let i = 0; i < events.length; i++) {
    const score = scorePublicationContentEventSearchQuery(events[i], query)
    if (score > 0) hits.push([i, score])
  }
  ctx.postMessage({ id, hits } satisfies LibrarySearchScoreResponse)
}
