import { ExtendedKind } from '@/constants'
import {
  approxLibraryIndexEventBytes,
  getLibraryIndexCacheBudget
} from '@/lib/library-index-cache-config'
import logger from '@/lib/logger'
import { filterStructuralIndexEvents } from '@/lib/publication-index'
import indexedDb from '@/services/indexed-db.service'
import type { Event } from 'nostr-tools'

export async function loadLibraryIndexCacheEvents(): Promise<Event[]> {
  try {
    const cached = await indexedDb.getLibraryPublicationIndexCacheEvents()
    // IDB rows were verified on write; structural re-check only (avoid ~5k verifyEvent on read).
    const structural = filterStructuralIndexEvents(cached)
    if (structural.length < cached.length) {
      void indexedDb
        .pruneUnverifiedLibraryPublicationIndexCacheEvents()
        .catch(() => {})
    }
    return structural
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
  const kind30040 = events.filter((ev) => ev.kind === ExtendedKind.PUBLICATION)
  if (kind30040.length === 0) return
  try {
    const budget = getLibraryIndexCacheBudget()
    await indexedDb.mergeLibraryPublicationIndexCacheEvents(kind30040, budget)
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
