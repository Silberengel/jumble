import { archivesMetadataListToProfiles } from '@/lib/archives-profile-metadata'
import client from '@/services/client.service'
import { candidateKeysForNoteUrlId } from '@/services/navigation-event-store'
import nostrArchivesApi from '@/services/nostr-archives-api.service'
import noteStatsService from '@/services/note-stats.service'
import type { TArchivesNotePageBundle } from '@/types/nostr-archives'
import type { TProfile } from '@/types'
import type { Event } from 'nostr-tools'

function resolveEventPointerToHex(eventId: string): string | undefined {
  const trimmed = eventId.trim()
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase()
  for (const key of candidateKeysForNoteUrlId(trimmed)) {
    if (/^[0-9a-f]{64}$/i.test(key)) return key.toLowerCase()
  }
  return undefined
}

/** Single verified event from Archives `GET /v1/events/{id}` (persisted by API client). */
export async function resolveNoteEventFromArchives(eventId: string): Promise<Event | undefined> {
  if (!nostrArchivesApi.isAvailable()) return undefined
  const hex = resolveEventPointerToHex(eventId)
  if (!hex) return undefined

  const res = await nostrArchivesApi.getEventById(hex)
  if (!res.ok) return undefined

  client.addEventToCache(res.data, { explicitNoteLookupHexId: hex })
  return res.data
}

/** Full note page bundle: main event, replies, profile map, interaction counts. */
export async function fetchArchivesNotePageBundle(
  eventId: string,
  limit = 50
): Promise<TArchivesNotePageBundle | undefined> {
  if (!nostrArchivesApi.isAvailable()) return undefined
  const hex = resolveEventPointerToHex(eventId)
  if (!hex) return undefined

  const res = await nostrArchivesApi.getNotePage(hex, limit)
  if (!res.ok) return undefined

  noteStatsService.applyArchivesInteractionCounts(hex, res.data.interactions)
  client.addEventToCache(res.data.event, { explicitNoteLookupHexId: hex })
  for (const reply of res.data.replies) {
    client.addEventToCache(reply)
  }

  return res.data
}

/** Profiles from a note page bundle (`GET /v1/pages/note/{id}` `profiles` map). */
export function profilesFromArchivesNotePageBundle(bundle: TArchivesNotePageBundle): TProfile[] {
  return archivesMetadataListToProfiles(Object.values(bundle.profiles))
}

/** Fire-and-forget: hydrate replies + interaction counts while the note panel opens. */
export function prewarmArchivesNotePage(
  eventId: string,
  limit = 50,
  onBundle?: (bundle: TArchivesNotePageBundle) => void
): void {
  void fetchArchivesNotePageBundle(eventId, limit)
    .then((bundle) => {
      if (bundle) onBundle?.(bundle)
    })
    .catch(() => {})
}
