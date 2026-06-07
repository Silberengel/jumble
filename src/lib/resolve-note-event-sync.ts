import { getNoteBech32Id } from '@/lib/event'
import client from '@/services/client.service'
import { navigationEventStore } from '@/services/navigation-event-store'
import type { Event } from 'nostr-tools'

function initialEventMatchesId(initialEvent: Event, eventId: string): boolean {
  if (initialEvent.id === eventId) return true
  try {
    return getNoteBech32Id(initialEvent) === eventId
  } catch {
    return false
  }
}

/** Synchronous note lookup: navigation store → session cache (feed clicks seed both before the panel mounts). */
export function resolveNoteEventSync(eventId: string | undefined, initialEvent?: Event): Event | undefined {
  if (!eventId?.trim()) return initialEvent

  if (initialEvent && initialEventMatchesId(initialEvent, eventId)) {
    return initialEvent
  }

  const fromNav = navigationEventStore.peekEvent(eventId)
  if (fromNav) return fromNav

  return client.peekSessionCachedEvent(eventId.trim())
}
