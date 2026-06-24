import { eventTagAddress } from '@/lib/publication-index'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import type { Event } from 'nostr-tools'

export const LIBRARY_PUBLICATION_READING_INTENT_EVENT = 'library-publication-reading-intent'

export type LibraryPublicationReadingIntent = {
  rootEventId: string
  /** Stable replaceable address when root id differs between index cache and note fetch. */
  rootAddress?: string
  sectionAddress: string
  highlightQuery: string
  contentEvent?: Event
}

let pendingIntent: LibraryPublicationReadingIntent | null = null
const activeReadingIntents = new Map<string, LibraryPublicationReadingIntent>()

export function readingIntentMatchesEvent(
  intent: LibraryPublicationReadingIntent,
  event: Event
): boolean {
  if (intent.rootEventId === event.id) return true
  const addr = eventTagAddress(event)
  return Boolean(intent.rootAddress && addr && intent.rootAddress === addr)
}

function rememberActiveIntent(intent: LibraryPublicationReadingIntent): void {
  activeReadingIntents.set(intent.rootEventId, intent)
  if (intent.rootAddress) activeReadingIntents.set(intent.rootAddress, intent)
}

export function setLibraryPublicationReadingIntent(intent: LibraryPublicationReadingIntent): void {
  pendingIntent = intent
  rememberActiveIntent(intent)
  if (intent.contentEvent) {
    client.addEventToCache(intent.contentEvent)
    void indexedDb.putReplaceableEvent(intent.contentEvent).catch(() => {})
  }
  window.dispatchEvent(
    new CustomEvent(LIBRARY_PUBLICATION_READING_INTENT_EVENT, { detail: intent })
  )
}

export function peekLibraryPublicationReadingIntentForEvent(
  event: Event
): LibraryPublicationReadingIntent | null {
  if (pendingIntent && readingIntentMatchesEvent(pendingIntent, event)) return pendingIntent

  const byId = activeReadingIntents.get(event.id)
  if (byId && readingIntentMatchesEvent(byId, event)) return byId

  const addr = eventTagAddress(event)
  if (addr) {
    const byAddr = activeReadingIntents.get(addr)
    if (byAddr && readingIntentMatchesEvent(byAddr, event)) return byAddr
  }

  return null
}

/** Take pending intent for this root, or return the already-active reading session. */
export function resolveLibraryPublicationReadingIntent(
  event: Event
): LibraryPublicationReadingIntent | null {
  if (pendingIntent && readingIntentMatchesEvent(pendingIntent, event)) {
    const intent = pendingIntent
    pendingIntent = null
    rememberActiveIntent(intent)
    return intent
  }
  return peekLibraryPublicationReadingIntentForEvent(event)
}

export function clearLibraryPublicationReadingIntent(event: Event): void {
  const addr = eventTagAddress(event)
  activeReadingIntents.delete(event.id)
  if (addr) activeReadingIntents.delete(addr)
  if (pendingIntent && readingIntentMatchesEvent(pendingIntent, event)) {
    pendingIntent = null
  }
}
