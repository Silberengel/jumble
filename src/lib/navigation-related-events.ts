import { getParentBech32Id, getRootBech32Id } from '@/lib/event'
import { toNote } from '@/lib/link'
import client from '@/services/client.service'
import type { Event } from 'nostr-tools'

/**
 * Parent / root events already in the session cache (e.g. from {@link ParentNotePreview} or the feed).
 * Passed into {@link navigateToNote} as `relatedEvents` so {@link NotePage} can render the thread strip
 * without a refetch — especially when the side panel mounts without `initialEvent`.
 */
export function getCachedThreadContextEvents(forEvent: Event): Event[] {
  const byId = new Map<string, Event>()
  const tryAdd = (bech32OrHex?: string) => {
    if (!bech32OrHex?.trim()) return
    const ev = client.peekSessionCachedEvent(bech32OrHex.trim())
    if (ev) byId.set(ev.id.toLowerCase(), ev)
  }
  tryAdd(getParentBech32Id(forEvent))
  tryAdd(getRootBech32Id(forEvent))
  return [...byId.values()]
}

export type NavigateToNoteFn = (url: string, event?: Event, relatedEvents?: Event[]) => void

/** Prefer a fetched event, else the session cache — same seeding as parent preview clicks in feeds. */
export function resolveCachedNoteEvent(fetched: Event | undefined, noteId?: string): Event | undefined {
  if (fetched) return fetched
  if (!noteId?.trim()) return undefined
  return client.peekSessionCachedEvent(noteId.trim())
}

export function openNoteFromFetchOrCache(
  navigateToNote: NavigateToNoteFn,
  noteId: string,
  fetched?: Event
): void {
  const resolved = resolveCachedNoteEvent(fetched, noteId)
  if (resolved) {
    navigateToNote(toNote(resolved), resolved, getCachedThreadContextEvents(resolved))
    return
  }
  navigateToNote(toNote(noteId))
}
