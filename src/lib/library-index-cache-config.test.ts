import { describe, expect, it } from 'vitest'
import {
  approxLibraryIndexEventBytes,
  getLibraryIndexCacheBudget,
  LIBRARY_INDEX_CACHE_DEFAULTS
} from '@/lib/library-index-cache-config'
import { ExtendedKind } from '@/constants'
import type { Event } from 'nostr-tools'

function sampleIndexEvent(tagCount: number): Event {
  const tags: string[][] = [
    ['d', 'sample-book'],
    ['title', 'Sample Book']
  ]
  for (let i = 0; i < tagCount; i++) {
    tags.push(['a', `30041:${'a'.repeat(64)}:chapter-${i}`, 'wss://relay.example', 'b'.repeat(64)])
  }
  return {
    id: 'c'.repeat(64),
    kind: ExtendedKind.PUBLICATION,
    pubkey: 'a'.repeat(64),
    created_at: 1_700_000_000,
    content: '',
    tags,
    sig: 'd'.repeat(128)
  }
}

describe('library-index-cache-config', () => {
  it('approxLibraryIndexEventBytes returns positive size', () => {
    const bytes = approxLibraryIndexEventBytes(sampleIndexEvent(3))
    expect(bytes).toBeGreaterThan(100)
  })

  it('getLibraryIndexCacheBudget returns platform defaults', () => {
    const budget = getLibraryIndexCacheBudget()
    expect(budget.maxEntries).toBeGreaterThanOrEqual(LIBRARY_INDEX_CACHE_DEFAULTS.maxEntriesMobile)
    expect(budget.maxBytes).toBeGreaterThanOrEqual(LIBRARY_INDEX_CACHE_DEFAULTS.maxMbMobile * 1024 * 1024)
  })

  it('5000 mercury-sized indexes land near documented desktop budget', () => {
    const avgMercuryBytes = 14_131
    const est5000Mb = (avgMercuryBytes * LIBRARY_INDEX_CACHE_DEFAULTS.maxEntriesDesktop) / (1024 * 1024)
    expect(est5000Mb).toBeGreaterThan(50)
    expect(est5000Mb).toBeLessThan(120)
    expect(LIBRARY_INDEX_CACHE_DEFAULTS.maxMbDesktop).toBeGreaterThanOrEqual(Math.ceil(est5000Mb))
  })
})
