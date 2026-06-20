import { resolveNoteEventSync } from '@/lib/resolve-note-event-sync'
import { resolveThreadContextEventFromLocalStores } from '@/lib/thread-context-local'
import type { Event } from 'nostr-tools'

/** Session → local stores before any relay REQ (shared by useFetchEvent / useFetchThreadContextEvent). */
export async function resolveNoteEventBeforeRelayFetch(
  eventId: string,
  initialEvent: Event | undefined,
  isEventDeleted: (event: Event) => boolean
): Promise<Event | undefined> {
  const syncHit = resolveNoteEventSync(eventId, initialEvent)
  if (syncHit && !isEventDeleted(syncHit)) return syncHit

  const localHit = await resolveThreadContextEventFromLocalStores(eventId, initialEvent)
  if (localHit && !isEventDeleted(localHit)) return localHit

  return undefined
}

export function noteEventNeedsRelayFetch(
  eventId: string | undefined,
  initialEvent: Event | undefined
): boolean {
  if (!eventId) return false
  return !resolveNoteEventSync(eventId, initialEvent)
}
