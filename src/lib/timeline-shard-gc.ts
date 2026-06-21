/** Max persisted timeline leaf shards across all feeds (LRU eviction above this). */
export const TIMELINE_SHARD_GC_MAX_TOTAL = 128

export type TimelineShardMeta = {
  key: string
  feedScopeKey?: string
  lastAccessAt: number
}

/**
 * Pick timeline shard row keys to delete: stale shards for the active feed wave, then global LRU trim.
 */
export function selectTimelineShardKeysToEvict(
  rows: readonly TimelineShardMeta[],
  opts: {
    feedScopeKey?: string
    keepKeys?: ReadonlySet<string>
    maxTotal: number
  }
): string[] {
  const toDelete = new Set<string>()

  if (opts.feedScopeKey && opts.keepKeys) {
    for (const row of rows) {
      if (row.feedScopeKey === opts.feedScopeKey && !opts.keepKeys.has(row.key)) {
        toDelete.add(row.key)
      }
    }
  }

  const remaining = rows.filter((r) => !toDelete.has(r.key))
  if (remaining.length > opts.maxTotal) {
    const sorted = [...remaining].sort((a, b) => a.lastAccessAt - b.lastAccessAt)
    const excess = remaining.length - opts.maxTotal
    for (let i = 0; i < excess; i++) {
      toDelete.add(sorted[i]!.key)
    }
  }

  return [...toDelete]
}

/** One-time cleanup: rows persisted before feed-scope tagging. */
export function legacyTimelineShardKeys(rows: readonly TimelineShardMeta[]): string[] {
  return rows.filter((r) => !r.feedScopeKey?.trim()).map((r) => r.key)
}
