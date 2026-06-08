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
  /** Accepted for API compat; reconcile is a no-op after v43 store consolidation. */
  reconcile?: boolean
}

let persistQueue: Promise<void> = Promise.resolve()

/** Load kind-30040 catalog masters from {@link StoreNames.PUBLICATION_EVENTS}. */
export async function loadLibraryIndexCacheEvents(): Promise<Event[]> {
  try {
    const cached = await indexedDb.getPublicationCatalogIndexEvents()
    const structural = filterStructuralIndexEvents(cached)
    const map = buildStructuralPublicationIndexMap(structural)
    return publicationIndexMapValues(map)
  } catch (e) {
    if (import.meta.env.DEV) {
      logger.warn('[Library] publication catalog IDB read failed', {
        message: e instanceof Error ? e.message : String(e)
      })
    }
    return []
  }
}

/** Persist kind-30040 catalog masters into {@link StoreNames.PUBLICATION_EVENTS}. */
export async function persistLibraryIndexCacheEvents(
  events: Event[],
  _options?: PersistLibraryIndexCacheOptions
): Promise<void> {
  const map = buildStructuralPublicationIndexMap(filterStructuralIndexEvents(events))
  const normalized = publicationIndexMapValues(map)
  if (normalized.length === 0) return

  const run = async () => {
    try {
      const budget = getLibraryIndexCacheBudget()
      await indexedDb.mergePublicationCatalogIndexEvents(normalized, budget)
    } catch (e) {
      if (import.meta.env.DEV) {
        logger.warn('[Library] publication catalog IDB write failed', {
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
    return await indexedDb.getPublicationCatalogFootprint()
  } catch {
    return { count: 0, bytes: 0 }
  }
}

export async function clearLibraryIndexIdbCache(): Promise<void> {
  await indexedDb.clearPublicationCatalogDiscoveryOnly()
}

export { approxLibraryIndexEventBytes, getLibraryIndexCacheBudget }
