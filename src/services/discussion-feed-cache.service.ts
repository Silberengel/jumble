import logger from '@/lib/logger'

interface CachedDiscussionsListData {
  eventMap: Map<string, unknown>
  dynamicTopics: {
    mainTopics: unknown[]
    subtopics: unknown[]
    allTopics: unknown[]
  }
  timestamp: number
}

/**
 * In-memory cache for the discussions list feed (thread reply cache lives in thread-panel-cache).
 */
class DiscussionsListCacheService {
  static instance: DiscussionsListCacheService
  private discussionsListCache: CachedDiscussionsListData | null = null
  private readonly DISCUSSIONS_LIST_CACHE_TTL_MS = 2 * 60 * 1000
  private readonly MAX_DISCUSSIONS_LIST_THREADS = 400

  static getInstance(): DiscussionsListCacheService {
    if (!DiscussionsListCacheService.instance) {
      DiscussionsListCacheService.instance = new DiscussionsListCacheService()
    }
    return DiscussionsListCacheService.instance
  }

  private discussionsEntryRecency(entry: unknown): number {
    if (!entry || typeof entry !== 'object') return 0
    const o = entry as Record<string, unknown>
    for (const k of ['lastReplyAt', 'lastActivityAt', 'updatedAt', 'fetchedAt']) {
      const v = o[k]
      if (typeof v === 'number' && v > 0) return v
    }
    const root = o.rootEvent ?? o.event ?? o.threadRoot
    if (root && typeof root === 'object' && 'created_at' in root) {
      const ca = (root as { created_at?: unknown }).created_at
      if (typeof ca === 'number') return ca
    }
    return 0
  }

  private trimDiscussionsEventMap(
    map: Map<string, unknown>,
    prioritizeIds: ReadonlySet<string>
  ): Map<string, unknown> {
    if (map.size <= this.MAX_DISCUSSIONS_LIST_THREADS) return map
    const entries = [...map.entries()].sort((a, b) => {
      const pa = prioritizeIds.has(a[0]) ? 1 : 0
      const pb = prioritizeIds.has(b[0]) ? 1 : 0
      if (pa !== pb) return pb - pa
      return this.discussionsEntryRecency(b[1]) - this.discussionsEntryRecency(a[1])
    })
    const next = new Map<string, unknown>()
    for (let i = 0; i < this.MAX_DISCUSSIONS_LIST_THREADS && i < entries.length; i++) {
      const row = entries[i]
      if (row) next.set(row[0], row[1])
    }
    return next
  }

  getCachedDiscussionsList(): CachedDiscussionsListData | null {
    if (!this.discussionsListCache) {
      logger.debug('[DiscussionsListCache] cache miss')
      return null
    }
    return this.discussionsListCache
  }

  hasFreshDiscussionsListCache(): boolean {
    if (!this.discussionsListCache) return false
    const age = Date.now() - this.discussionsListCache.timestamp
    return age <= this.DISCUSSIONS_LIST_CACHE_TTL_MS
  }

  setCachedDiscussionsList(
    eventMap: Map<string, unknown>,
    dynamicTopics: { mainTopics: unknown[]; subtopics: unknown[]; allTopics: unknown[] },
    merge = true
  ): void {
    const newIds = new Set(eventMap.keys())
    let mergedEventMap: Map<string, unknown>
    const existingCacheSize = this.discussionsListCache?.eventMap.size || 0

    if (merge && this.discussionsListCache) {
      mergedEventMap = new Map(this.discussionsListCache.eventMap)
      eventMap.forEach((entry, threadId) => {
        mergedEventMap.set(threadId, entry)
      })
      logger.debug(
        '[DiscussionsListCache] merged discussions list: existing:',
        existingCacheSize,
        'new:',
        eventMap.size,
        'total:',
        mergedEventMap.size
      )
    } else {
      mergedEventMap = new Map(eventMap)
    }

    mergedEventMap = this.trimDiscussionsEventMap(mergedEventMap, newIds)

    this.discussionsListCache = {
      eventMap: mergedEventMap,
      dynamicTopics: {
        mainTopics: [...dynamicTopics.mainTopics],
        subtopics: [...dynamicTopics.subtopics],
        allTopics: [...dynamicTopics.allTopics]
      },
      timestamp: Date.now()
    }
  }

  clearDiscussionsListCache(): void {
    this.discussionsListCache = null
    logger.debug('[DiscussionsListCache] cleared')
  }
}

const instance = DiscussionsListCacheService.getInstance()
export default instance
