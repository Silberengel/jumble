import { ExtendedKind } from '@/constants'
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
    if (normalized.length !== cached.length) {
      void persistLibraryIndexCacheEvents(normalized).catch(() => {})
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

export async function persistLibraryIndexCacheEvents(events: Event[]): Promise<void> {
  const map = buildStructuralPublicationIndexMap(filterStructuralIndexEvents(events))
  const normalized = publicationIndexMapValues(map)
  if (normalized.length === 0) return
  try {
    const budget = getLibraryIndexCacheBudget()
    await indexedDb.mergeLibraryPublicationIndexCacheEvents(normalized, budget)
    await indexedDb.reconcileLibraryPublicationIndexCache(map)
  } catch (e) {
    if (import.meta.env.DEV) {
      logger.warn('[Library] index IDB write failed', {
        message: e instanceof Error ? e.message : String(e)
      })
    }
  }
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
