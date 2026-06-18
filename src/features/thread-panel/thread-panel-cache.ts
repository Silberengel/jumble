import { isNip25ReactionKind } from '@/lib/event'
import { isThreadBoosterOnlyRow } from '@/lib/thread-response-filter'
import type { Event } from 'nostr-tools'
import { THREAD_PANEL_CACHE_MAX_KEYS } from './constants'
import type { TRootInfo } from './types'

type CachedThreadData = {
  replies: Event[]
  timestamp: number
  rootInfo: TRootInfo
}

function cacheKey(rootInfo: TRootInfo): string {
  if (rootInfo.type === 'E') return `thread:E:${rootInfo.id}`
  if (rootInfo.type === 'A') return `thread:A:${rootInfo.id}`
  return `thread:I:${rootInfo.id}`
}

class ThreadPanelCacheService {
  private cache = new Map<string, CachedThreadData>()

  getCachedReplies(rootInfo: TRootInfo): Event[] | null {
    const key = cacheKey(rootInfo)
    const row = this.cache.get(key)
    if (!row) return null
    if (row.rootInfo.type !== rootInfo.type || row.rootInfo.id !== rootInfo.id) {
      this.cache.delete(key)
      return null
    }
    return row.replies.filter((r) => !isNip25ReactionKind(r.kind) && !isThreadBoosterOnlyRow(r))
  }

  setCachedReplies(rootInfo: TRootInfo, replies: Event[]): void {
    const key = cacheKey(rootInfo)
    const existing = this.cache.get(key)
    let merged: Event[]
    if (
      existing &&
      existing.rootInfo.type === rootInfo.type &&
      existing.rootInfo.id === rootInfo.id
    ) {
      const ids = new Set(existing.replies.map((r) => r.id))
      const added = replies.filter((r) => !ids.has(r.id))
      merged = [...existing.replies, ...added].filter(
        (r) => !isNip25ReactionKind(r.kind) && !isThreadBoosterOnlyRow(r)
      )
    } else {
      merged = replies.filter((r) => !isNip25ReactionKind(r.kind) && !isThreadBoosterOnlyRow(r))
    }
    this.cache.set(key, {
      replies: merged,
      timestamp: Date.now(),
      rootInfo: { ...rootInfo }
    })
    this.trimIfNeeded()
  }

  private trimIfNeeded(): void {
    if (this.cache.size <= THREAD_PANEL_CACHE_MAX_KEYS) return
    const entries = [...this.cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)
    const overflow = this.cache.size - THREAD_PANEL_CACHE_MAX_KEYS
    for (let i = 0; i < overflow; i++) {
      const k = entries[i]?.[0]
      if (k) this.cache.delete(k)
    }
  }

  clearCache(rootInfo: TRootInfo): void {
    this.cache.delete(cacheKey(rootInfo))
  }
}

const instance = new ThreadPanelCacheService()
export default instance
