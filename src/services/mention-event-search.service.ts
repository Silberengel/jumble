/**
 * Unified search for mentions (npubs) and event/note picker (nevent/naddr).
 * Both use the same pattern: cache first, then IndexedDB, then relays, up to limit.
 */

import { buildCitationPickerSearchRelayUrls } from '@/lib/citation-picker-relays'
import {
  citationPickerMatchesQuery,
  tryParseCitationEventIdFromQuery
} from '@/lib/citation-picker-search'
import { ExtendedKind, NIP71_VIDEO_KINDS, NIP_SEARCH_PAGE_KINDS, SEARCHABLE_RELAY_URLS } from '@/constants'
import { normalizeUrl } from '@/lib/url'
import { kinds, type Event as NEvent } from 'nostr-tools'
import client, { eventService, queryService } from './client.service'
import indexedDb from './indexed-db.service'
import { eventMatchesNip50LocalFullTextQuery } from '@/lib/nip50-local-text-match'
import { collectLocalEventsForTextSearch } from '@/lib/local-nip50-search-merge'

const DEFAULT_NOTES_LIMIT = 20

/** Max npubs in the @-mention dropdown (local + follows + relay merge). */
export const MENTION_NPUB_DROPDOWN_LIMIT = 50

/** Kinds for nevent search: notes, threads, long-form, etc. */
export const NEVENT_KINDS = [
  kinds.ShortTextNote,
  ExtendedKind.PICTURE,
  ...NIP71_VIDEO_KINDS,
  ExtendedKind.POLL,
  ExtendedKind.COMMENT,
  ExtendedKind.VOICE,
  ExtendedKind.VOICE_COMMENT,
  ExtendedKind.PUBLIC_MESSAGE,
  ExtendedKind.DISCUSSION,
  ExtendedKind.CITATION_INTERNAL,
  ExtendedKind.CITATION_EXTERNAL,
  ExtendedKind.CITATION_HARDCOPY,
  ExtendedKind.CITATION_PROMPT
] as const

/** Same NIP-50 kinds as Search → Notes (without kind-0 metadata rows in the picker). */
export const PICKER_NEVENT_KINDS = NIP_SEARCH_PAGE_KINDS.filter((k) => k !== kinds.Metadata)

/** NIP-32 citation events only (Advanced lab citation picker, etc.). */
export const CITATION_PICKER_KINDS = [
  ExtendedKind.CITATION_INTERNAL,
  ExtendedKind.CITATION_EXTERNAL,
  ExtendedKind.CITATION_HARDCOPY,
  ExtendedKind.CITATION_PROMPT
] as const

/** Kinds for naddr search: calendar, publications, wiki, etc. */
export const NADDR_KINDS = [
  ExtendedKind.CALENDAR_EVENT_DATE, 
  ExtendedKind.CALENDAR_EVENT_TIME, 
  ExtendedKind.PUBLICATION, 
  ExtendedKind.WIKI_ARTICLE, 
  ExtendedKind.NOSTR_SPECIFICATION, 
  ExtendedKind.PUBLICATION_CONTENT,
  kinds.LongFormArticle,
  ExtendedKind.MUSIC_TRACK
] as const

export type PickerSearchMode = 'nevent' | 'naddr'

/** True when `kindFilter` is exactly the four NIP-32 citation kinds (any order, each once). */
function isCitationOnlyKindFilter(kindFilter: readonly number[] | undefined): boolean {
  if (!kindFilter?.length) return false
  const a = [...CITATION_PICKER_KINDS].sort((x, y) => x - y)
  const b = [...kindFilter].sort((x, y) => x - y)
  if (a.length !== b.length) return false
  return a.every((k, i) => k === b[i])
}

async function searchCitationEventsForPickerInternal(
  q: string,
  limit: number,
  kindsList: number[]
): Promise<NEvent[]> {
  const seen = new Set<string>()
  const out: NEvent[] = []

  const push = (evt: NEvent, requireFieldMatch: boolean) => {
    if (seen.has(evt.id)) return
    if (requireFieldMatch && !citationPickerMatchesQuery(evt, q)) return
    seen.add(evt.id)
    out.push(evt)
  }

  const idHex = tryParseCitationEventIdFromQuery(q)

  for (const ev of eventService.getSessionCitationFieldSearch(q, limit)) {
    push(ev, false)
    if (out.length >= limit) return out.slice(0, limit)
  }

  const needAfterSession = limit - out.length
  const [idEv, fromArch, relayUrls] = await Promise.all([
    idHex ? client.fetchEvent(idHex) : Promise.resolve(null),
    needAfterSession > 0
      ? indexedDb.getCachedAndArchivedCitationFieldSearch(q, needAfterSession, kindsList, {
          archiveScanMaxMs: 14_000
        })
      : Promise.resolve([] as NEvent[]),
    buildCitationPickerSearchRelayUrls()
  ])

  if (idEv && kindsList.includes(idEv.kind)) push(idEv, false)
  if (out.length >= limit) return out.slice(0, limit)

  for (const ev of fromArch) {
    push(ev, false)
    if (out.length >= limit) return out.slice(0, limit)
  }

  const need = limit - out.length
  if (need <= 0) return out.slice(0, limit)

  const nip50Limit = Math.max(need, 8)
  const broadLimit = Math.min(160, Math.max(need * 8, 48))

  const [fromNip50, fromBroad] = await Promise.all([
    queryService.fetchEvents(
      relayUrls,
      { kinds: kindsList, search: q, limit: nip50Limit },
      { eoseTimeout: 8500, globalTimeout: 14_000 }
    ),
    queryService.fetchEvents(
      SEARCHABLE_RELAY_URLS,
      { kinds: kindsList, limit: broadLimit },
      { eoseTimeout: 5000, globalTimeout: 9000 }
    )
  ])

  for (const ev of fromNip50) {
    push(ev, true)
    if (out.length >= limit) return out.slice(0, limit)
  }
  for (const ev of fromBroad) {
    push(ev, true)
    if (out.length >= limit) break
  }

  return out.slice(0, limit)
}

/** Local DB + session budget for picker search (before relay NIP-50). */
const PICKER_LOCAL_DB_MERGE_CAP = 880
const PICKER_FULLTEXT_DB_CAP = 260
/** IndexedDB archive scan for picker — keep short so the dialog is not stuck on skeletons. */
const PICKER_ARCHIVE_SCAN_MAX_MS = 4_000

/**
 * Search for events: session cache → IndexedDB (publication + archive + cross-store full text) → relays.
 * Merges and dedupes by event id, up to limit.
 * @param mode - 'nevent' uses NEVENT_KINDS (incl. NIP-71 video 21/22/34235), 'naddr' uses NADDR_KINDS (30023,30817,30818,30040).
 * @param kindFilter - When set, only these kinds are searched (overrides `mode` for the kinds list).
 */
export async function searchEventsForPicker(
  query: string,
  limit: number = DEFAULT_NOTES_LIMIT,
  mode: PickerSearchMode = 'nevent',
  kindFilter?: readonly number[],
  onUpdate?: (events: NEvent[]) => void
): Promise<NEvent[]> {
  const q = query.trim()
  if (!q) return []

  const kindsList =
    kindFilter && kindFilter.length > 0
      ? [...kindFilter]
      : mode === 'nevent'
        ? [...PICKER_NEVENT_KINDS]
        : [...NADDR_KINDS]

  if (isCitationOnlyKindFilter(kindFilter)) {
    return searchCitationEventsForPickerInternal(q, limit, kindsList)
  }

  const seen = new Set<string>()
  const out: NEvent[] = []

  const addUnique = (evt: NEvent) => {
    if (seen.has(evt.id)) return
    seen.add(evt.id)
    out.push(evt)
  }

  const emit = () => {
    if (onUpdate) onUpdate(out.slice(0, limit))
  }

  const sessionCap = Math.min(1500, Math.max(limit * 8, 200))
  const localMergeTarget = Math.min(PICKER_LOCAL_DB_MERGE_CAP, Math.max(limit * 10, 240))

  for (const ev of eventService.getSessionEventsMatchingSearch(q, sessionCap, kindsList)) {
    addUnique(ev)
  }

  const viewerPk = client.pubkey?.trim().toLowerCase()
  if (viewerPk && /^[0-9a-f]{64}$/.test(viewerPk)) {
    for (const ev of eventService.listSessionEventsAuthoredBy(viewerPk, {
      kinds: kindsList,
      limit: Math.min(400, sessionCap)
    })) {
      if (eventMatchesNip50LocalFullTextQuery(ev, q)) addUnique(ev)
    }
  }
  emit()

  const userCentricRelayUrls = await buildCitationPickerSearchRelayUrls()
  const relayLimit = Math.max(limit, 20)
  const searchableNip50Layer = Array.from(
    new Set(SEARCHABLE_RELAY_URLS.map((u) => normalizeUrl(u) || u.trim()).filter(Boolean))
  ).slice(0, 28)

  const [fromLocalMerged, fromUserCentric, fromSearchableIndex] = await Promise.all([
    collectLocalEventsForTextSearch({
      query: q,
      allowedKinds: kindsList,
      sessionCap: 0,
      idbMergedLimit: localMergeTarget,
      archiveScanMaxMs: PICKER_ARCHIVE_SCAN_MAX_MS,
      includeOtherStoresFullText: true,
      fullTextStoreHitCap: Math.min(PICKER_FULLTEXT_DB_CAP, Math.max(localMergeTarget, 200))
    }),
    queryService.fetchEvents(
      userCentricRelayUrls,
      { kinds: kindsList, search: q, limit: relayLimit },
      { eoseTimeout: 5000, globalTimeout: 8000 }
    ),
    searchableNip50Layer.length > 0
      ? queryService.fetchEvents(
          searchableNip50Layer,
          { kinds: kindsList, search: q, limit: relayLimit },
          { eoseTimeout: 6500, globalTimeout: 12_000 }
        )
      : Promise.resolve([] as NEvent[])
  ])

  for (const ev of fromLocalMerged) addUnique(ev)
  emit()

  for (const ev of fromUserCentric) addUnique(ev)
  for (const ev of fromSearchableIndex) addUnique(ev)
  emit()

  return out.slice(0, limit)
}

/** Search only NIP-32 citation events (kinds 30–33). */
export async function searchCitationEventsForPicker(
  query: string,
  limit: number = DEFAULT_NOTES_LIMIT
): Promise<NEvent[]> {
  return searchEventsForPicker(query, limit, 'nevent', CITATION_PICKER_KINDS)
}

/**
 * Search for npubs for @-mentions. Uses same pattern as note search: cache (follow + local index) then relays.
 * Delegates to client which already does follow-list → local index → relay search.
 * Supports incremental updates via onUpdate callback for faster UI updates.
 */
export async function searchNpubsForMention(
  query: string,
  limit: number = MENTION_NPUB_DROPDOWN_LIMIT,
  onUpdate?: (npubs: string[]) => void
): Promise<string[]> {
  const capped = Math.min(Math.max(1, Math.floor(limit)), MENTION_NPUB_DROPDOWN_LIMIT)
  return client.searchNpubsForMention(query, capped, onUpdate)
}
