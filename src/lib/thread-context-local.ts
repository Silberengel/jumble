import {
  getNoteBech32Id,
  getParentBech32Id,
  getParentEventHexId,
  getRootBech32Id,
  getRootEventHexId,
  resolveDeclaredThreadRootEventHex
} from '@/lib/event'
import { shouldDropEventOnIngest } from '@/lib/event-ingest-filter'
import { resolveNoteEventFromArchives } from '@/lib/note-page-load-pipeline'
import client, { eventService } from '@/services/client.service'
import { loadArchivedEventForFetch } from '@/services/event-archive.service'
import { candidateKeysForNoteUrlId } from '@/services/navigation-event-store'
import { navigationEventStore } from '@/services/navigation-event-store'
import type { Event } from 'nostr-tools'

export function resolveEventPointerToHex(eventId: string): string | undefined {
  const trimmed = eventId.trim()
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase()
  for (const key of candidateKeysForNoteUrlId(trimmed)) {
    if (/^[0-9a-f]{64}$/i.test(key)) return key.toLowerCase()
  }
  return undefined
}

function eventMatchesPointer(ev: Event, eventId: string): boolean {
  if (ev.id === eventId) return true
  try {
    return getNoteBech32Id(ev) === eventId
  } catch {
    return false
  }
}

/** Session, navigation store, archive, publication store, and timeline disk — for parent/root strips. */
export async function resolveThreadContextEventFromLocalStores(
  eventId: string,
  initialEvent?: Event
): Promise<Event | undefined> {
  if (initialEvent && eventMatchesPointer(initialEvent, eventId)) {
    return initialEvent
  }

  const fromNav = navigationEventStore.peekEvent(eventId)
  if (fromNav) return fromNav

  const fromSession = client.peekSessionCachedEvent(eventId)
  if (fromSession) return fromSession

  const hex = resolveEventPointerToHex(eventId)
  if (!hex) return undefined

  const fromArchive = await loadArchivedEventForFetch(hex)
  if (fromArchive && !shouldDropEventOnIngest(fromArchive, { explicitNoteLookupHexId: hex })) {
    client.addEventToCache(fromArchive, { explicitNoteLookupHexId: hex })
    return fromArchive
  }

  const fromArchivesApi = await Promise.race([
    resolveNoteEventFromArchives(hex),
    new Promise<undefined>((resolve) => setTimeout(resolve, 700))
  ])
  if (fromArchivesApi && !shouldDropEventOnIngest(fromArchivesApi, { explicitNoteLookupHexId: hex })) {
    return fromArchivesApi
  }

  const fromPublication = await eventService.peekPublicationStoreEvent(hex)
  if (fromPublication) return fromPublication

  const rows = await client.getLocalFeedEvents(
    [{ urls: [], filter: { ids: [hex], limit: 1 } }],
    { maxMatches: 1, maxRowsScanned: 14_000 }
  )
  const hit = rows[0]
  if (hit && !shouldDropEventOnIngest(hit, { explicitNoteLookupHexId: hex })) {
    client.addEventToCache(hit, { explicitNoteLookupHexId: hex })
    return hit
  }

  return undefined
}

/** Parent + root events from local stores before opening a note panel (avoids thread strip skeletons). */
export async function prefetchThreadContextForNavigation(forEvent: Event): Promise<Event[]> {
  const pointers = new Set<string>()
  const parentId = getParentBech32Id(forEvent)
  const rootId = getRootBech32Id(forEvent)
  if (parentId) pointers.add(parentId)
  if (rootId) pointers.add(rootId)

  const parentHex = getParentEventHexId(forEvent)?.toLowerCase()
  const rootHex = getRootEventHexId(forEvent)?.toLowerCase()
  if (parentHex && /^[0-9a-f]{64}$/i.test(parentHex)) pointers.add(parentHex)
  if (rootHex && /^[0-9a-f]{64}$/i.test(rootHex)) {
    pointers.add(resolveDeclaredThreadRootEventHex(rootHex))
  }

  pointers.delete(forEvent.id.toLowerCase())

  const out: Event[] = []
  const seen = new Set<string>()
  for (const pointer of pointers) {
    const ev = await resolveThreadContextEventFromLocalStores(pointer)
    if (!ev || seen.has(ev.id.toLowerCase())) continue
    seen.add(ev.id.toLowerCase())
    out.push(ev)
  }
  return out
}
