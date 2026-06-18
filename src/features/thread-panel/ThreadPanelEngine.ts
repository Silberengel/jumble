import type { Event } from 'nostr-tools'
import type { ThreadPanelSource } from './types'
import type { ThreadPanelStoreSnapshot } from './types'
import { ingestThreadPanelEvents } from './ThreadPanelStore'

/** Cancels in-flight relay/local loads when the open note or refresh token changes. */
export class ThreadPanelEngine {
  private generation = 0

  bumpGeneration(): number {
    this.generation += 1
    return this.generation
  }

  currentGeneration(): number {
    return this.generation
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation
  }
}

export type ThreadPanelIngestFn = (events: Event[], source?: ThreadPanelSource) => void

/** Unified ingest funnel: updates store, note-stats, and session cache. */
export function threadPanelIngest(
  store: ThreadPanelStoreSnapshot,
  events: readonly Event[],
  source: ThreadPanelSource,
  opts: {
    statsRootEvent: Event
    statsRootPubkey: string
  }
): ThreadPanelStoreSnapshot {
  return ingestThreadPanelEvents(store, events, source, {
    statsRootEvent: opts.statsRootEvent,
    statsRootPubkey: opts.statsRootPubkey
  })
}
