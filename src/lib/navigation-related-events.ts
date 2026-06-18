import {
  getParentBech32Id,
  getParentEventHexId,
  getRootBech32Id,
  getRootEventHexId,
  resolveDeclaredThreadRootEventHex
} from '@/lib/event'
import { toNote } from '@/lib/link'
import { resolveNoteEventSync } from '@/lib/resolve-note-event-sync'
import { prefetchThreadContextForNavigation } from '@/lib/thread-context-local'
import client from '@/services/client.service'
import type { Event } from 'nostr-tools'
import { navigationEventStore } from '@/services/navigation-event-store'

/**
 * Parent / root events already in the session cache (e.g. from {@link ParentNotePreview} or the feed).
 * Passed into {@link navigateToNote} as `relatedEvents` so {@link NotePage} can render the thread strip
 * without a refetch — especially when the side panel mounts without `initialEvent`.
 */
export function getCachedThreadContextEvents(forEvent: Event): Event[] {
  const byId = new Map<string, Event>()
  const tryAdd = (pointer?: string) => {
    if (!pointer?.trim()) return
    const ev = resolveNoteEventSync(pointer.trim())
    if (ev) byId.set(ev.id.toLowerCase(), ev)
  }
  tryAdd(getParentBech32Id(forEvent))
  tryAdd(getRootBech32Id(forEvent))
  const parentHex = getParentEventHexId(forEvent)?.toLowerCase()
  const rootHex = getRootEventHexId(forEvent)?.toLowerCase()
  if (parentHex) tryAdd(parentHex)
  if (rootHex) {
    tryAdd(rootHex)
    if (/^[0-9a-f]{64}$/i.test(rootHex)) {
      tryAdd(resolveDeclaredThreadRootEventHex(rootHex))
    }
  }
  return [...byId.values()]
}

export type NavigateToNoteFn = (url: string, event?: Event, relatedEvents?: Event[]) => void

/** Prefer a fetched event, else the session cache — same seeding as parent preview clicks in feeds. */
export function resolveCachedNoteEvent(fetched: Event | undefined, noteId?: string): Event | undefined {
  if (fetched) return fetched
  if (!noteId?.trim()) return undefined
  return client.peekSessionCachedEvent(noteId.trim())
}

export async function openNoteFromFetchOrCache(
  navigateToNote: NavigateToNoteFn,
  noteId: string,
  fetched?: Event
): Promise<void> {
  const resolved = resolveCachedNoteEvent(fetched, noteId)
  if (resolved) {
    await seedThreadContextForNavigation(resolved)
    navigateToNote(toNote(resolved), resolved, getCachedThreadContextEvents(resolved))
    return
  }
  navigateToNote(toNote(noteId))
}

/** Seed navigation store with parent/root from disk before the note panel mounts. */
export async function seedThreadContextForNavigation(event: Event): Promise<Event[]> {
  const prefetched = await prefetchThreadContextForNavigation(event)
  for (const ev of prefetched) {
    client.addEventToCache(ev)
    navigationEventStore.setEvent(ev)
  }
  return prefetched
}
