import { scorePublicationContentEventSearchQuery } from '@/lib/general-search-scoring'
import logger from '@/lib/logger'
import type { Event } from 'nostr-tools'
import type {
  LibrarySearchScoreRequest,
  LibrarySearchScoreResponse
} from '@/workers/library-search.worker'

/**
 * Main-thread client for {@link library-search.worker}. Lazily spins up a single persistent module worker
 * and routes content-event scoring through it. Every entry point degrades gracefully to synchronous
 * main-thread scoring when Workers are unavailable (SSR, jsdom tests, older environments) or the worker
 * fails to start, so callers always get correct results.
 */

/** Below this candidate count the postMessage / structured-clone overhead outweighs offloading. */
const WORKER_MIN_BATCH = 24

type Pending = {
  resolve: (hits: Array<[number, number]>) => void
  reject: (error: unknown) => void
}

let worker: Worker | null = null
let workerUnavailable = false
let nextRequestId = 1
const pending = new Map<number, Pending>()

function scoreSynchronously(query: string, events: Event[]): Array<[number, number]> {
  const hits: Array<[number, number]> = []
  for (let i = 0; i < events.length; i++) {
    const score = scorePublicationContentEventSearchQuery(events[i], query)
    if (score > 0) hits.push([i, score])
  }
  return hits
}

function ensureWorker(): Worker | null {
  if (workerUnavailable) return null
  if (worker) return worker
  if (typeof Worker === 'undefined') {
    workerUnavailable = true
    return null
  }
  try {
    worker = new Worker(new URL('../workers/library-search.worker.ts', import.meta.url), {
      type: 'module'
    })
    worker.onmessage = (e: MessageEvent<LibrarySearchScoreResponse>) => {
      const { id, hits } = e.data
      const entry = pending.get(id)
      if (entry) {
        pending.delete(id)
        entry.resolve(hits)
      }
    }
    worker.onerror = (e) => {
      // A worker-level error invalidates in-flight requests; reject them so callers fall back.
      const error = e instanceof ErrorEvent ? e.message : 'library search worker error'
      for (const entry of pending.values()) entry.reject(error)
      pending.clear()
      logger.warn('[LibrarySearch] worker error, falling back to main-thread scoring', { error })
      worker?.terminate()
      worker = null
      workerUnavailable = true
    }
    return worker
  } catch (e) {
    logger.warn('[LibrarySearch] failed to start worker, using main-thread scoring', {
      message: e instanceof Error ? e.message : String(e)
    })
    workerUnavailable = true
    return null
  }
}

/**
 * Score `events` against `query` off the main thread, returning `[index, score]` pairs (score > 0 only).
 * Falls back to synchronous scoring for small batches or when the worker is unavailable.
 */
export function scoreContentEventsForSearch(
  query: string,
  events: Event[]
): Promise<Array<[number, number]>> {
  if (events.length < WORKER_MIN_BATCH) {
    return Promise.resolve(scoreSynchronously(query, events))
  }
  const active = ensureWorker()
  if (!active) {
    return Promise.resolve(scoreSynchronously(query, events))
  }

  const id = nextRequestId++
  return new Promise<Array<[number, number]>>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    active.postMessage({ id, query, events } satisfies LibrarySearchScoreRequest)
  }).catch((e) => {
    logger.warn('[LibrarySearch] worker scoring failed, using main-thread scoring', {
      message: e instanceof Error ? e.message : String(e)
    })
    return scoreSynchronously(query, events)
  })
}
