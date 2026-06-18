import { mergeRepliesIntoMap } from '@/lib/reply-index'
import client from '@/services/client.service'
import noteStatsService from '@/services/note-stats.service'
import type { Event } from 'nostr-tools'
import type { ThreadPanelSource, ThreadPanelStoreSnapshot } from './types'

export function createThreadPanelStore(): ThreadPanelStoreSnapshot {
  return {
    byId: new Map(),
    index: new Map()
  }
}

export type ThreadPanelIngestOptions = {
  statsRootEvent?: Event
  statsRootPubkey?: string
  updateStats?: boolean
}

/** Merge events into byId + tag index; optionally prime note-stats. */
export function ingestThreadPanelEvents(
  store: ThreadPanelStoreSnapshot,
  events: readonly Event[],
  _source: ThreadPanelSource,
  opts?: ThreadPanelIngestOptions
): ThreadPanelStoreSnapshot {
  if (events.length === 0) return store

  const nextById = new Map(store.byId)
  for (const ev of events) {
    nextById.set(ev.id.toLowerCase(), ev)
  }

  const nextIndex = mergeRepliesIntoMap(store.index, [...events])

  if (opts?.updateStats !== false && events.length > 0) {
    noteStatsService.updateNoteStatsByEvents([...events], opts?.statsRootPubkey, {
      statsRootEvent: opts?.statsRootEvent
    })
  }

  for (const ev of events) {
    client.addEventToCache(ev)
  }

  return { byId: nextById, index: nextIndex }
}

export function cloneThreadPanelStore(store: ThreadPanelStoreSnapshot): ThreadPanelStoreSnapshot {
  return {
    byId: new Map(store.byId),
    index: store.index
  }
}

export function eventsFromThreadPanelStore(store: ThreadPanelStoreSnapshot): Event[] {
  const seen = new Set<string>()
  const out: Event[] = []
  for (const ev of store.byId.values()) {
    if (seen.has(ev.id)) continue
    seen.add(ev.id)
    out.push(ev)
  }
  for (const bucket of store.index.values()) {
    for (const ev of bucket.events) {
      if (seen.has(ev.id)) continue
      seen.add(ev.id)
      out.push(ev)
    }
  }
  return out
}

export function replyIdInStore(store: ThreadPanelStoreSnapshot, id: string): boolean {
  const key = id.toLowerCase()
  if (store.byId.has(key)) return true
  for (const bucket of store.index.values()) {
    if (bucket.eventIdSet.has(id)) return true
  }
  return false
}

export type { ThreadPanelStoreSnapshot } from './types'
