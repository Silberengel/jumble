import {
  approxLibraryIndexEventBytes,
  getLibraryIndexCacheBudget
} from '@/lib/library-index-cache-config'
import logger from '@/lib/logger'
import {
  buildStructuralPublicationIndexMap,
  filterStructuralIndexEvents,
  publicationIndexMapValues
} from '@/lib/publication-index'
import indexedDb from '@/services/indexed-db.service'
import type { Event } from 'nostr-tools'

type PersistLibraryIndexCacheOptions = {
  /** When false, merge rows only — skip reconcile so partial batches cannot wipe unrelated cache rows. */
  reconcile?: boolean
}

let persistQueue: Promise<void> = Promise.resolve()

export async function loadLibraryIndexCacheEvents(): Promise<Event[]> {
  try {
    const cached = await indexedDb.getLibraryPublicationIndexCacheEvents()
    // Structural re-check + address dedupe only — avoid ~5k verifyEvent on read (main-thread hang).
    const structural = filterStructuralIndexEvents(cached)
    const map = buildStructuralPublicationIndexMap(structural)
    const normalized = publicationIndexMapValues(map)
    if (structural.length < cached.length) {
      void indexedDb.pruneUnverifiedLibraryPublicationIndexCacheEvents().catch(() => {})
    }
    const hasLegacyKeys = await indexedDb.libraryPublicationIndexCacheHasLegacyKeys()
    if (normalized.length !== cached.length || hasLegacyKeys) {
      void persistLibraryIndexCacheEvents(normalized, { reconcile: true }).catch(() => {})
    }
    return normalized
  } catch (e) {
    if (import.meta.env.DEV) {
      logger.warn('[Library] index IDB read failed', {
        message: e instanceof Error ? e.message : String(e)
      })
    }
    return []
  }
}

export async function persistLibraryIndexCacheEvents(
  events: Event[],
  options?: PersistLibraryIndexCacheOptions
): Promise<void> {
  const map = buildStructuralPublicationIndexMap(filterStructuralIndexEvents(events))
  const normalized = publicationIndexMapValues(map)
  if (normalized.length === 0) return

  const reconcile = options?.reconcile !== false
  const run = async () => {
    try {
      const budget = getLibraryIndexCacheBudget()
      await indexedDb.mergeLibraryPublicationIndexCacheEvents(normalized, budget)
      if (reconcile) {
        await indexedDb.reconcileLibraryPublicationIndexCache(map)
      }
    } catch (e) {
      if (import.meta.env.DEV) {
        logger.warn('[Library] index IDB write failed', {
          message: e instanceof Error ? e.message : String(e)
        })
      }
    }
  }

  persistQueue = persistQueue.then(run, run)
  return persistQueue
}

export async function getLibraryIndexCacheFootprint(): Promise<{ count: number; bytes: number }> {
  try {
    return await indexedDb.getLibraryPublicationIndexCacheFootprint()
  } catch {
    return { count: 0, bytes: 0 }
  }
}

export async function clearLibraryIndexIdbCache(): Promise<void> {
  await indexedDb.clearLibraryPublicationIndexCacheStore()
}

export { approxLibraryIndexEventBytes, getLibraryIndexCacheBudget }
