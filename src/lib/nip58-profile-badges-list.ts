import {
  ExtendedKind,
  METADATA_BATCH_QUERY_EOSE_TIMEOUT_MS,
  METADATA_BATCH_QUERY_GLOBAL_TIMEOUT_MS
} from '@/constants'
import {
  isNip58ProfileBadgesListEvent,
  LEGACY_PROFILE_BADGES_D_TAG,
  parseAddressableCoordinate,
  parseProfileBadgeEntries,
  resolveBadgeDisplayFromDefinition,
  type ProfileBadgeEntry,
  type ResolvedProfileBadge
} from '@/lib/nip58-profile-badges'
import { normalizeHexPubkey } from '@/lib/pubkey'
import { fetchLatestReplaceableListEvent } from '@/lib/replaceable-list-latest'
import { normalizeAnyRelayUrl } from '@/lib/url'
import client, { replaceableEventService } from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import type { Event } from 'nostr-tools'

export function profileBadgeEntriesToTags(entries: ProfileBadgeEntry[]): string[][] {
  const tags: string[][] = []
  for (const entry of entries) {
    tags.push(['a', entry.definitionCoordinate])
    tags.push(['e', entry.awardEventId])
  }
  return tags
}

export function profileBadgeListTagsAfterRemovingEntry(
  tags: string[][],
  entry: ProfileBadgeEntry
): string[][] | null {
  const parsed = parseProfileBadgeEntries({ kind: ExtendedKind.PROFILE_BADGES_LIST, tags } as Event)
  const next = parsed.filter(
    (row) =>
      !(
        row.definitionCoordinate === entry.definitionCoordinate &&
        row.awardEventId === entry.awardEventId
      )
  )
  if (next.length === parsed.length) return null
  return profileBadgeEntriesToTags(next)
}

async function loadProfileBadgesListFromLocalCache(pubkeyHex: string): Promise<Event | undefined> {
  const pk = normalizeHexPubkey(pubkeyHex)
  let cached: Event | undefined
  try {
    const disk = await indexedDb.getReplaceableEvent(pk, ExtendedKind.PROFILE_BADGES_LIST)
    if (disk) cached = disk
  } catch {
    cached = undefined
  }
  const sessionHits = client.eventService.listSessionEventsAuthoredBy(pk, {
    kinds: [ExtendedKind.PROFILE_BADGES_LIST],
    limit: 8
  })
  for (const ev of sessionHits) {
    if (!isNip58ProfileBadgesListEvent(ev)) continue
    if (!cached || ev.created_at >= cached.created_at) cached = ev
  }
  if (cached && isNip58ProfileBadgesListEvent(cached)) return cached

  try {
    const legacy =
      (await indexedDb.getReplaceableEvent(pk, ExtendedKind.PROFILE_BADGES, LEGACY_PROFILE_BADGES_D_TAG)) ??
      undefined
    if (legacy && isNip58ProfileBadgesListEvent(legacy)) return legacy
  } catch {
    /* best-effort */
  }
  return undefined
}

async function loadBadgeDefinitionFromLocalCache(coordinate: string): Promise<Event | undefined> {
  const parsed = parseAddressableCoordinate(coordinate)
  if (!parsed || parsed.kind !== ExtendedKind.BADGE_DEFINITION) return undefined
  try {
    const disk = await indexedDb.getReplaceableEvent(parsed.pubkey, parsed.kind, parsed.d)
    if (disk) return disk
  } catch {
    /* best-effort */
  }
  return undefined
}

/** Resolve NIP-58 badges from IndexedDB/session only (no relay REQ). */
export async function hydrateProfileBadgesFromLocalCache(
  pubkeyHex: string
): Promise<ResolvedProfileBadge[]> {
  let listEvent = await loadProfileBadgesListFromLocalCache(pubkeyHex)
  if (!listEvent || !isNip58ProfileBadgesListEvent(listEvent)) return []
  const entries = parseProfileBadgeEntries(listEvent)
  const defCoords = [...new Set(entries.map((e) => e.definitionCoordinate))]
  const defByCoord = new Map<string, Event | undefined>()
  await Promise.all(
    defCoords.map(async (coord) => {
      defByCoord.set(coord, await loadBadgeDefinitionFromLocalCache(coord))
    })
  )
  return entries.map((entry) =>
    resolveBadgeDisplayFromDefinition(entry, defByCoord.get(entry.definitionCoordinate))
  )
}

export async function fetchProfileBadgesListEvent(
  pubkeyHex: string,
  relayUrls: string[],
  options?: { foreground?: boolean; /** When true and local cache exists, return cache immediately and skip relay wait. */ cacheFirst?: boolean }
): Promise<Event | undefined> {
  const pk = normalizeHexPubkey(pubkeyHex)
  const foreground = options?.foreground === true
  const cacheFirst = options?.cacheFirst !== false
  let cached = await loadProfileBadgesListFromLocalCache(pk)
  if (cacheFirst && cached) {
    return cached
  }
  try {
    const fromService =
      (await replaceableEventService.fetchReplaceableEvent(pk, ExtendedKind.PROFILE_BADGES_LIST)) ??
      undefined
    if (!cached) cached = fromService
    else if (fromService && fromService.created_at >= cached.created_at) cached = fromService
  } catch {
    /* best-effort */
  }
  const fromRelays = relayUrls.length
    ? await fetchLatestReplaceableListEvent(pk, ExtendedKind.PROFILE_BADGES_LIST, relayUrls, {
        foreground
      })
    : undefined
  if (!cached) return fromRelays
  if (!fromRelays) return cached
  return fromRelays.created_at >= cached.created_at ? fromRelays : cached
}

/** Deprecated NIP-58 profile badges (kind 30008, d=profile_badges). */
export async function fetchLegacyProfileBadgesListEvent(
  pubkeyHex: string,
  relayUrls: string[],
  options?: { cacheFirst?: boolean }
): Promise<Event | undefined> {
  const pk = normalizeHexPubkey(pubkeyHex)
  const cacheFirst = options?.cacheFirst !== false
  let cached: Event | undefined
  if (cacheFirst) {
    try {
      const legacyDisk = await indexedDb.getReplaceableEvent(
        pk,
        ExtendedKind.PROFILE_BADGES,
        LEGACY_PROFILE_BADGES_D_TAG
      )
      if (legacyDisk && isNip58ProfileBadgesListEvent(legacyDisk)) cached = legacyDisk
    } catch {
      cached = undefined
    }
  }
  if (!cached) {
    try {
      cached =
        (await replaceableEventService.fetchReplaceableEvent(
          pk,
          ExtendedKind.PROFILE_BADGES,
          LEGACY_PROFILE_BADGES_D_TAG
        )) ?? undefined
    } catch {
      cached = undefined
    }
  }
  if (cacheFirst && cached) return cached

  const allUrls = [...new Set(relayUrls.map((u) => normalizeAnyRelayUrl(u) || u).filter(Boolean))]
  if (!allUrls.length) return cached

  const rows = await client.fetchEvents(
    allUrls,
    {
      authors: [pk],
      kinds: [ExtendedKind.PROFILE_BADGES],
      '#d': [LEGACY_PROFILE_BADGES_D_TAG],
      limit: 20
    },
    {
      replaceableRace: true,
      eoseTimeout: METADATA_BATCH_QUERY_EOSE_TIMEOUT_MS,
      globalTimeout: METADATA_BATCH_QUERY_GLOBAL_TIMEOUT_MS,
      foreground: true
    }
  )

  const legacyRows = rows.filter(isNip58ProfileBadgesListEvent)
  if (!legacyRows.length) return cached
  const newest = legacyRows.reduce((best, e) => (e.created_at > best.created_at ? e : best))
  if (!cached) return newest
  return newest.created_at >= cached.created_at ? newest : cached
}

export function shouldOfferProfileBadgesMigration(
  currentList: Event | null | undefined,
  legacyList: Event | null | undefined
): boolean {
  if (!legacyList || !isNip58ProfileBadgesListEvent(legacyList)) return false
  const legacyEntries = parseProfileBadgeEntries(legacyList)
  if (legacyEntries.length === 0) return false
  if (!currentList || currentList.kind !== ExtendedKind.PROFILE_BADGES_LIST) return true
  const currentEntries = parseProfileBadgeEntries(currentList)
  if (currentEntries.length === 0) return true
  return legacyList.created_at > currentList.created_at
}
