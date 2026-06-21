import { describe, expect, it } from 'vitest'
import {
  legacyTimelineShardKeys,
  selectTimelineShardKeysToEvict,
  TIMELINE_SHARD_GC_MAX_TOTAL
} from './timeline-shard-gc'

describe('selectTimelineShardKeysToEvict', () => {
  it('drops stale shards for a feed scope not in the active wave', () => {
    const rows = [
      { key: 'a', feedScopeKey: 'home', lastAccessAt: 100 },
      { key: 'b', feedScopeKey: 'home', lastAccessAt: 200 },
      { key: 'c', feedScopeKey: 'spells', lastAccessAt: 150 }
    ]
    const evict = selectTimelineShardKeysToEvict(rows, {
      feedScopeKey: 'home',
      keepKeys: new Set(['b']),
      maxTotal: TIMELINE_SHARD_GC_MAX_TOTAL
    })
    expect(evict).toEqual(['a'])
  })

  it('LRU-trims when total exceeds maxTotal', () => {
    const rows = [
      { key: 'old', feedScopeKey: 'x', lastAccessAt: 1 },
      { key: 'mid', feedScopeKey: 'x', lastAccessAt: 2 },
      { key: 'new', feedScopeKey: 'x', lastAccessAt: 3 }
    ]
    const evict = selectTimelineShardKeysToEvict(rows, {
      maxTotal: 2
    })
    expect(evict).toEqual(['old'])
  })
})

describe('legacyTimelineShardKeys', () => {
  it('returns keys without feedScopeKey', () => {
    const rows = [
      { key: 'legacy', lastAccessAt: 1 },
      { key: 'scoped', feedScopeKey: 'home', lastAccessAt: 2 }
    ]
    expect(legacyTimelineShardKeys(rows)).toEqual(['legacy'])
  })
})
