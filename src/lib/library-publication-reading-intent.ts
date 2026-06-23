import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import type { Event } from 'nostr-tools'

export const LIBRARY_PUBLICATION_READING_INTENT_EVENT = 'library-publication-reading-intent'

export type LibraryPublicationReadingIntent = {
  rootEventId: string
  sectionAddress: string
  highlightQuery: string
  contentEvent?: Event
}

let pendingIntent: LibraryPublicationReadingIntent | null = null

export function setLibraryPublicationReadingIntent(intent: LibraryPublicationReadingIntent): void {
  pendingIntent = intent
  if (intent.contentEvent) {
    client.addEventToCache(intent.contentEvent)
    void indexedDb.putReplaceableEvent(intent.contentEvent).catch(() => {})
  }
  window.dispatchEvent(
    new CustomEvent(LIBRARY_PUBLICATION_READING_INTENT_EVENT, { detail: intent })
  )
}

export function consumeLibraryPublicationReadingIntent(
  rootEventId: string
): LibraryPublicationReadingIntent | null {
  if (!pendingIntent || pendingIntent.rootEventId !== rootEventId) return null
  const intent = pendingIntent
  pendingIntent = null
  return intent
}
