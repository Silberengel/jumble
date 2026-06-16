import { isMobileBrowserProfile } from '@/lib/client-platform'
import type { Event } from 'nostr-tools'

/** Platform caps for the dedicated Library kind-30040 index LRU store (separate from EVENT_ARCHIVE). */
export const LIBRARY_INDEX_CACHE_DEFAULTS = {
  maxEntriesMobile: 400,
  maxEntriesDesktop: 5000,
  maxMbMobile: 40,
  maxMbDesktop: 96
} as const

export function approxLibraryIndexEventBytes(ev: Event): number {
  try {
    return new Blob([JSON.stringify(ev)]).size
  } catch {
    return 2048
  }
}

export function getLibraryIndexCacheBudget(): { maxEntries: number; maxBytes: number } {
  if (isMobileBrowserProfile()) {
    return {
      maxEntries: LIBRARY_INDEX_CACHE_DEFAULTS.maxEntriesMobile,
      maxBytes: LIBRARY_INDEX_CACHE_DEFAULTS.maxMbMobile * 1024 * 1024
    }
  }
  return {
    maxEntries: LIBRARY_INDEX_CACHE_DEFAULTS.maxEntriesDesktop,
    maxBytes: LIBRARY_INDEX_CACHE_DEFAULTS.maxMbDesktop * 1024 * 1024
  }
}
