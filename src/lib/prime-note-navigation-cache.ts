import { prefetchThreadContextForNavigation } from '@/lib/thread-context-local'
import client from '@/services/client.service'
import { navigationEventStore } from '@/services/navigation-event-store'
import type { Event } from 'nostr-tools'

export function primeNoteNavigationCache(
  noteId: string,
  event?: Event,
  relatedEvents?: Event[]
): void {
  navigationEventStore.clear()
  if (event) {
    navigationEventStore.setEvent(event, noteId)
    client.addEventToCache(event)
    void prefetchThreadContextForNavigation(event).then((prefetched) => {
      for (const ev of prefetched) {
        client.addEventToCache(ev)
        navigationEventStore.setEvent(ev)
      }
    })
  }
  if (relatedEvents?.length) {
    for (const ev of relatedEvents) {
      if (ev && ev !== event) {
        client.addEventToCache(ev)
        navigationEventStore.setEvent(ev)
      }
    }
  }
  if (event) {
    void client.prefetchEmbeddedEventsForParents(
      [event, ...(relatedEvents ?? []).filter((ev) => ev && ev !== event)]
    )
  }
}
