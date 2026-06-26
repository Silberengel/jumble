import { DOCUMENT_RELAY_URLS, ExtendedKind, LIBRARY_RELAY_URLS } from '@/constants'
import { tryParseCitationEventIdFromQuery } from '@/lib/citation-picker-search'
import {
  buildRelayContentSearchQuery,
  generalSearchQueryTerms,
  haystackMatchesPhraseQuery,
  haystackMatchesSearchQuery,
  isQuotedSearchQuery,
  metadataSearchHaystack,
  normalizeGeneralSearchQuery,
  publicationContentSectionHaystack,
  publicationContentSectionTitle,
  scorePublicationContentEventSearchQuery
} from '@/lib/general-search-text-match'
import { decodeProfileSearchQueryToPubkeyHex } from '@/lib/profile-search-query'
import { normalizeToDTag, parseAdvancedSearch } from '@/lib/search-parser'
import logger from '@/lib/logger'
import { extractNip32LabelValues, isBooklistNip32Label } from '@/lib/nip32-label'
import { queryIndexRelay, queryIndexRelayForLibrary, queryIndexRelayPublicationContentSearch, queryIndexRelayPublicationMetadataSearch } from '@/lib/index-relay-http'
import {
  buildIndexByAddress,
  buildStructuralPublicationIndexMap,
  collectReachableAddressesCached,
  eventTagAddress,
  filterValidIndexEvents,
  getReferencedChild30040Addresses,
  getTopLevelIndexEvents,
  getTopLevelIndexEventsFromMap,
  mergePublicationIndexMaps,
  publicationIndexMapValues,
  type PublicationIndexMap
} from '@/lib/publication-index'
import { getReplaceableCoordinateFromEvent, isReplaceableEvent } from '@/lib/event'
import { verifyEvent } from 'nostr-tools'
import { isEventInPinList } from '@/lib/replaceable-list-latest'
import { isRelayBlockedByUser } from '@/lib/relay-blocked'
import { stripLocalNetworkRelaysForWssReq } from '@/lib/relay-list-sanitize'
import { buildComprehensiveRelayList } from '@/lib/relay-list-builder'
import {
  clearLibraryIndexIdbCache,
  loadLibraryIndexCacheEvents,
  persistLibraryIndexCacheEvents
} from '@/lib/library-index-idb-cache'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import relayInfoService from '@/services/relay-info.service'
import {
  canonicalRelaySessionKey,
  httpIndexBasesForRelayQuery,
  normalizeHttpRelayUrl,
  normalizeUrl
} from '@/lib/url'
import { queryService } from '@/services/client.service'
import type { Event, Filter } from 'nostr-tools'
import { kinds, nip19 } from 'nostr-tools'

const INDEX_WS_PAGE_LIMIT = 500
const INDEX_HTTP_PAGE_LIMIT = 100
/** Cursor pages per relay for library index bulk load (up to ~50k WS / ~10k HTTP rows each). */
const INDEX_MAX_PAGES_PER_RELAY = 100
/** verifyEvent batch size — yield between chunks so the main thread stays responsive. */
const INDEX_VERIFY_CHUNK = 80
const ENGAGEMENT_ADDRESS_CHUNK = 36
const ENGAGEMENT_EVENT_ID_CHUNK = 44
/** Cap engagement relay queries to the first slice of the catalog (not the full index corpus). */
const MAX_TARGET_ADDRESSES = 120
const MAX_TARGET_EVENT_IDS = 160
const MAX_ENGAGEMENT_HTTP_CHUNKS = 6
const ENGAGEMENT_FETCH_TIMEOUT_MS = 25_000
export const LIBRARY_PAGE_SIZE = 120
const LIBRARY_SEARCH_READING_CACHE_LIMIT = 200
/** Cap on kind-30040 indexes pulled from the reading cache to resolve content hits to their root. */
const LIBRARY_CONTENT_ROOT_INDEX_SCAN_LIMIT = 4000
export const LIBRARY_RELAY_SEARCH_LIMIT = 100
const LIBRARY_RELAY_SEARCH_TIMEOUT_MS = 28_000

/** Max paginated WS pages per document relay when tag filters miss (no NIP-50 on document relays). */
const LIBRARY_DOCUMENT_RELAY_SCAN_MAX_PAGES = 15

/** Targeted kind-30040 lookup on document relays (thecitadel, etc.) — fast, per-relay, early return. */
const LIBRARY_DOCUMENT_RELAY_SEARCH_OPTS = {
  globalTimeout: 12_000,
  eoseTimeout: 4_000,
  firstRelayResultGraceMs: 2_000,
  foreground: true,
  relayOpSource: 'library-publication-document-relay-search'
} as const
/** Paginated kind-30041 scan on document / library relays (no server-side fulltext). */
const LIBRARY_CONTENT_RELAY_SCAN_MAX_PAGES = 16
const LIBRARY_CONTENT_RELAY_PAGE_LIMIT = 100
const LIBRARY_CONTENT_RELAY_SEARCH_OPTS = {
  globalTimeout: 18_000,
  eoseTimeout: 5_000,
  firstRelayResultGraceMs: 3_000,
  foreground: true,
  relayOpSource: 'library-publication-content-relay-search'
} as const
/** Max paginated HTTP pages when title/author metadata API is unavailable (Mercury v0.2.0). */
const LIBRARY_RELAY_SEARCH_SCAN_MAX_PAGES = 80
/** Title/author/d-tag substring search fallback when metadata API is unavailable or capped. */
const LIBRARY_TITLE_HTTP_SCAN_MAX_PAGES = 20
/** Cap parallel POST /api/publications/search needles per query. */
const LIBRARY_HTTP_METADATA_SEARCH_TERM_CAP = 10
/** NIP-51 pin list (kind 10001). */
const PIN_LIST_KIND = 10001
/** Per-relay WS page fetch — one relay at a time avoids multi-relay onclose resolving after ~1s. */
const LIBRARY_INDEX_QUERY_OPTS = {
  globalTimeout: 45_000,
  eoseTimeout: 8_000,
  firstRelayResultGraceMs: false as const,
  foreground: true
} as const

/** First-page batch: unblock the library grid quickly. */
const LIBRARY_INDEX_FIRST_PAGE_OPTS = {
  globalTimeout: 12_000,
  eoseTimeout: 5_000,
  firstRelayResultGraceMs: false as const,
  foreground: true
} as const

const ENGAGEMENT_QUERY_OPTS = {
  globalTimeout: 45_000,
  eoseTimeout: 8_000,
  firstRelayResultGraceMs: false as const
}

export type PublicationEngagementMaps = {
  labelAddresses: Set<string>
  labelEventIds: Set<string>
  labelValuesByAddress: Map<string, Set<string>>
  labelValuesByEventId: Map<string, Set<string>>
  booklistAddresses: Set<string>
  booklistEventIds: Set<string>
  myBooklistAddresses: Set<string>
  myBooklistEventIds: Set<string>
  myCommentAddresses: Set<string>
  myCommentEventIds: Set<string>
  myHighlightAddresses: Set<string>
  myHighlightEventIds: Set<string>
  commentAddresses: Set<string>
  commentEventIds: Set<string>
  highlightAddresses: Set<string>
  highlightEventIds: Set<string>
  bookmarkAddresses: Set<string>
  bookmarkEventIds: Set<string>
  pinAddresses: Set<string>
  pinEventIds: Set<string>
}

export type LibraryPublicationContentSearchMatch = {
  sectionAddress: string
  highlightQuery: string
  contentEvent: Event
  /** Higher = closer match (exact phrase beats scattered words). */
  matchScore: number
}

export type LibraryPublicationEntry = {
  event: Event
  hasLabel: boolean
  /** NIP-32 `l` tag values from kind-1985 events (e.g. "booklist"), not `L` namespaces (e.g. "ugc"). */
  labelNames: string[]
  hasBooklistLabel: boolean
  hasMyBooklistLabel: boolean
  hasMyComment: boolean
  hasMyHighlight: boolean
  hasComment: boolean
  hasHighlight: boolean
  hasBookmark: boolean
  hasPin: boolean
  engagementCount: number
  /** Set when this row matched via kind-30041 section body text. */
  contentSearchMatch?: LibraryPublicationContentSearchMatch
}

type LibraryIndexCache = {
  relayKey: string
  viewerPubkey: string | null
  indexByAddress: PublicationIndexMap
  engagement: PublicationEngagementMaps
}

let sessionCache: LibraryIndexCache | null = null

/** Merge relay-discovered kind-30040 rows into the session index and IndexedDB catalog. */
async function persistRelayDiscoveredLibraryIndexes(newEvents: Event[]): Promise<void> {
  if (newEvents.length === 0) return

  const incomingMap = buildStructuralPublicationIndexMap(newEvents)
  if (incomingMap.size === 0) return

  if (sessionCache) {
    sessionCache = {
      ...sessionCache,
      indexByAddress: mergePublicationIndexMaps(sessionCache.indexByAddress, incomingMap.values())
    }
  }

  await persistLibraryIndexCacheEvents([...incomingMap.values()])
}

type LibraryIndexLoadSnapshot = {
  engaged: LibraryPublicationEntry[]
  allIndexCount: number
  topLevelCount: number
  indexEvents: Event[]
}

type LibraryIndexLoadResult = LibraryIndexLoadSnapshot & {
  engagement: PublicationEngagementMaps
}

type LibraryIndexLoadJob = {
  relayKey: string
  forceRefresh: boolean
  promise: Promise<LibraryIndexLoadResult>
  onIndexesReadyListeners: Array<(snapshot: LibraryIndexLoadSnapshot) => void>
  lastProgressIndex: PublicationIndexMap | null
}

let indexLoadJob: LibraryIndexLoadJob | null = null

function indexEventsFromCache(cache: LibraryIndexCache): Event[] {
  return publicationIndexMapValues(cache.indexByAddress)
}

function emitIndexesReadySnapshot(
  listeners: Array<(snapshot: LibraryIndexLoadSnapshot) => void>,
  indexByAddress: PublicationIndexMap
) {
  if (listeners.length === 0) return
  const indexEvents = publicationIndexMapValues(indexByAddress)
  const topLevel = getTopLevelIndexEventsFromMap(indexByAddress)
  const snapshot: LibraryIndexLoadSnapshot = {
    engaged: buildRecentPublicationEntries(topLevel, indexByAddress, emptyPublicationEngagementMaps()),
    allIndexCount: indexEvents.length,
    topLevelCount: topLevel.length,
    indexEvents
  }
  for (const listener of listeners) {
    listener(snapshot)
  }
}

function registerIndexesReadyListener(
  job: LibraryIndexLoadJob,
  listener?: (snapshot: LibraryIndexLoadSnapshot) => void
) {
  if (!listener) return
  job.onIndexesReadyListeners.push(listener)
  if (job.lastProgressIndex) {
    emitIndexesReadySnapshot([listener], job.lastProgressIndex)
  }
}

type LibrarySearchSessionRow = {
  fingerprint: string
  entries: LibraryPublicationEntry[]
  mergedIndexEvents: Event[]
  relaySearched: boolean
}

const librarySearchSessionCache = new Map<string, LibrarySearchSessionRow>()

function librarySearchQueryKey(
  query: string,
  axis?: LibraryPublicationRelaySearchAxis | null
): string {
  const base = normalizeGeneralSearchQuery(query).toLowerCase()
  if (!axis) return base
  return `${axis}:${base}`
}

function librarySearchFingerprint(context: LibrarySearchContext): string {
  const engagement = context.engagement
  const engagementSize = engagement
    ? engagement.labelAddresses.size +
      engagement.labelEventIds.size +
      engagement.commentAddresses.size +
      engagement.commentEventIds.size +
      engagement.highlightAddresses.size +
      engagement.highlightEventIds.size +
      engagement.booklistAddresses.size +
      engagement.booklistEventIds.size +
      engagement.bookmarkAddresses.size +
      engagement.bookmarkEventIds.size +
      engagement.pinAddresses.size +
      engagement.pinEventIds.size +
      engagement.myBooklistAddresses.size +
      engagement.myBooklistEventIds.size +
      engagement.myCommentAddresses.size +
      engagement.myCommentEventIds.size +
      engagement.myHighlightAddresses.size +
      engagement.myHighlightEventIds.size
    : 0
  return `${context.indexEvents.length}:${engagementSize}`
}

function getLibrarySearchSessionRow(
  query: string,
  context: LibrarySearchContext,
  opts?: { requireRelaySearch?: boolean; axis?: LibraryPublicationRelaySearchAxis | null }
): LibrarySearchSessionRow | null {
  const key = librarySearchQueryKey(query, opts?.axis)
  if (!key) return null
  const row = librarySearchSessionCache.get(key)
  if (!row) return null
  if (row.fingerprint !== librarySearchFingerprint(context)) return null
  if (opts?.requireRelaySearch && !row.relaySearched) return null
  return row
}

function putLibrarySearchSessionRow(
  query: string,
  context: LibrarySearchContext,
  row: Omit<LibrarySearchSessionRow, 'fingerprint'>,
  axis?: LibraryPublicationRelaySearchAxis | null
): void {
  const key = librarySearchQueryKey(query, axis)
  if (!key) return
  librarySearchSessionCache.set(key, {
    ...row,
    fingerprint: librarySearchFingerprint(context)
  })
}

/** Empty local-only rows are provisional — relay search may still find matches. */
function isFinalLibrarySearchSessionRow(row: LibrarySearchSessionRow): boolean {
  return row.entries.length > 0 || row.relaySearched
}

/**
 * Passage / full-text ("content-primary") searches must never be satisfied by a cached *empty* result.
 * Their hit set depends on data that changes during a session: kind-30041 content only lands in the
 * reading cache when a publication is opened, and the full-text relay path is best-effort. The session
 * cache fingerprint (index size + engagement) does NOT change when that content cache grows, so caching
 * an empty content result as "final" would wrongly report "nothing found" forever — even after the user
 * has the matching publication stored locally.
 */
function isContentPrimarySearch(
  query: string,
  axis?: LibraryPublicationRelaySearchAxis | null
): boolean {
  return !axis && shouldSearchPublicationContentOnRelays(query)
}

/** A cached row that can be trusted: final, and (for content searches) not a stale empty result. */
function isServableLibrarySearchSessionRow(
  row: LibrarySearchSessionRow,
  query: string,
  axis?: LibraryPublicationRelaySearchAxis | null
): boolean {
  if (!isFinalLibrarySearchSessionRow(row)) return false
  if (row.entries.length === 0 && isContentPrimarySearch(query, axis)) return false
  return true
}

/** Sync read of cached search hits for the current index + engagement snapshot. */
export function peekLibrarySearchResults(
  query: string,
  context: LibrarySearchContext,
  axis?: LibraryPublicationRelaySearchAxis | null
): LibraryPublicationEntry[] | null {
  const row = getLibrarySearchSessionRow(query, context, { axis })
  if (!row) return null
  if (!isServableLibrarySearchSessionRow(row, query, axis)) return null
  return row.entries
}

export function clearLibrarySearchSessionCache(): void {
  librarySearchSessionCache.clear()
}

function relaySetKey(urls: string[]): string {
  return [...new Set(urls.map((u) => normalizeUrl(u) || u))].sort().join('|')
}

function splitWsAndHttpRelays(relayUrls: string[]): { wsRelays: string[]; httpRelays: string[] } {
  const httpKeys = new Set(
    httpIndexBasesForRelayQuery(relayUrls, []).map((u) => canonicalRelaySessionKey(u))
  )
  const wsRelays: string[] = []
  const httpRelays: string[] = []
  for (const url of relayUrls) {
    const key = canonicalRelaySessionKey(normalizeUrl(url) || url)
    if (httpKeys.has(key)) httpRelays.push(url)
    else if (!/^https?:\/\//i.test(url.trim())) wsRelays.push(url)
  }
  return { wsRelays, httpRelays }
}

function dedupeEventsById(events: Event[]): Event[] {
  const byId = new Map<string, Event>()
  for (const ev of events) {
    const prev = byId.get(ev.id)
    if (!prev) {
      byId.set(ev.id, ev)
      continue
    }
    const prevVerified = verifyEvent(prev)
    const nextVerified = verifyEvent(ev)
    if (nextVerified && !prevVerified) {
      byId.set(ev.id, ev)
      continue
    }
    if (prevVerified && !nextVerified) continue
    if (ev.created_at > prev.created_at) byId.set(ev.id, ev)
  }
  return [...byId.values()]
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function isLibraryDeepIndexRelay(url: string): boolean {
  const key = canonicalRelaySessionKey(normalizeLibraryRelayUrl(url) || url)
  return key !== '' && LIBRARY_DEEP_INDEX_RELAY_KEYS.has(key)
}

function oldestCreatedAt(events: Event[]): number {
  let oldest = Number.MAX_SAFE_INTEGER
  for (const ev of events) {
    if (ev.created_at < oldest) oldest = ev.created_at
  }
  return oldest
}

function mergeIndexPageBatch(out: Event[], seen: Set<string>, batch: Event[]): number {
  let oldest = batch[0]?.created_at ?? Number.MAX_SAFE_INTEGER
  for (const ev of batch) {
    if (ev.created_at < oldest) oldest = ev.created_at
    if (seen.has(ev.id)) continue
    seen.add(ev.id)
    out.push(ev)
  }
  return oldest
}

async function fetchWsIndexFirstPage(wsRelay: string, filter: Filter): Promise<Event[]> {
  const pageFilter: Filter = { ...filter, limit: INDEX_WS_PAGE_LIMIT }
  try {
    return await queryService.fetchEvents([wsRelay], [pageFilter], LIBRARY_INDEX_FIRST_PAGE_OPTS)
  } catch (e) {
    if (import.meta.env.DEV) {
      logger.warn('[Library] WS index first page failed', {
        wsRelay,
        message: e instanceof Error ? e.message : String(e)
      })
    }
    return []
  }
}

async function fetchHttpIndexFirstPage(baseUrl: string, filter: Filter): Promise<Event[]> {
  const pageFilter: Filter = { ...filter, limit: INDEX_HTTP_PAGE_LIMIT }
  try {
    const pageResult = await queryIndexRelayForLibrary(baseUrl, pageFilter)
    return pageResult.events
  } catch (e) {
    if (import.meta.env.DEV) {
      logger.warn('[Library] HTTP index first page failed', {
        baseUrl,
        message: e instanceof Error ? e.message : String(e)
      })
    }
    return []
  }
}

async function fetchRemainingPagesFromWsIndexRelay(
  wsRelay: string,
  filter: Filter,
  firstPage: Event[]
): Promise<Event[]> {
  if (firstPage.length < INDEX_WS_PAGE_LIMIT) return []

  const out: Event[] = []
  const seen = new Set(firstPage.map((ev) => ev.id))
  let until = oldestCreatedAt(firstPage) - 1
  if (until < 0) return []

  for (let page = 1; page < INDEX_MAX_PAGES_PER_RELAY; page++) {
    const pageFilter: Filter = {
      ...filter,
      limit: INDEX_WS_PAGE_LIMIT,
      until
    }
    let batch: Event[] = []
    try {
      batch = await queryService.fetchEvents([wsRelay], [pageFilter], LIBRARY_INDEX_QUERY_OPTS)
    } catch (e) {
      if (import.meta.env.DEV) {
        logger.warn('[Library] WS index page failed', {
          wsRelay,
          page,
          message: e instanceof Error ? e.message : String(e)
        })
      }
      break
    }
    if (batch.length === 0) break

    const oldest = mergeIndexPageBatch(out, seen, batch)
    if (batch.length < INDEX_WS_PAGE_LIMIT) break
    if (oldest === Number.MAX_SAFE_INTEGER) break
    until = oldest - 1
  }

  return out
}

async function fetchRemainingPagesFromHttpIndexRelay(
  baseUrl: string,
  filter: Filter,
  firstPage: Event[]
): Promise<Event[]> {
  if (firstPage.length === 0) return []

  const out: Event[] = []
  const seen = new Set(firstPage.map((ev) => ev.id))
  let until = oldestCreatedAt(firstPage) - 1
  if (until < 0) return []

  for (let page = 1; page < INDEX_MAX_PAGES_PER_RELAY; page++) {
    const pageFilter: Filter = {
      ...filter,
      limit: INDEX_HTTP_PAGE_LIMIT,
      until
    }
    let batch: Event[] = []
    let apiRowCount = 0
    try {
      const pageResult = await queryIndexRelayForLibrary(baseUrl, pageFilter)
      batch = pageResult.events
      apiRowCount = pageResult.apiRowCount
    } catch (e) {
      if (import.meta.env.DEV) {
        logger.warn('[Library] HTTP index page failed', {
          baseUrl,
          page,
          message: e instanceof Error ? e.message : String(e)
        })
      }
      break
    }
    if (apiRowCount === 0) break

    const oldest = mergeIndexPageBatch(out, seen, batch)
    if (apiRowCount < INDEX_HTTP_PAGE_LIMIT) break
    if (oldest === Number.MAX_SAFE_INTEGER) break
    until = oldest - 1
  }

  return out
}

function normalizeLibraryRelayUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  const http = normalizeHttpRelayUrl(trimmed)
  if (http) return http
  return normalizeUrl(trimmed) || trimmed
}

const LIBRARY_DEEP_INDEX_RELAY_KEYS = new Set(
  LIBRARY_RELAY_URLS.map((url) =>
    canonicalRelaySessionKey(normalizeLibraryRelayUrl(url) || url)
  ).filter(Boolean)
)

function filterBlockedLibraryRelays(urls: string[], blockedRelays: readonly string[] = []): string[] {
  if (blockedRelays.length === 0) return urls
  return urls.filter((url) => !isRelayBlockedByUser(url, blockedRelays))
}

function libraryIndexRelayUrls(extraRelayUrls: string[] = [], blockedRelays: readonly string[] = []): string[] {
  const base = filterBlockedLibraryRelays(
    LIBRARY_RELAY_URLS.map(normalizeLibraryRelayUrl).filter(Boolean),
    blockedRelays
  )
  const extra = filterBlockedLibraryRelays(
    extraRelayUrls.map(normalizeLibraryRelayUrl).filter(Boolean),
    blockedRelays
  )
  return [...new Set([...base, ...extra])]
}

export async function buildLibraryRelayUrls(
  userPubkey?: string,
  blockedRelays: readonly string[] = []
): Promise<string[]> {
  const base = libraryIndexRelayUrls([], blockedRelays)
  const urls = await buildComprehensiveRelayList({
    userPubkey,
    includeUserOwnRelays: true,
    includeFastReadRelays: false,
    includeSearchableRelays: false,
    includeFavoriteRelays: false,
    relayHints: base,
    blockedRelays: [...blockedRelays]
  })
  return libraryIndexRelayUrls([...urls], blockedRelays)
}

/** Relay hints from kind-30040 `a` tags (section relay URLs). */
function collectPublicationRelayHints(indexEvents: Event[]): string[] {
  const hints = new Set<string>()
  for (const ev of indexEvents) {
    for (const tag of ev.tags) {
      if (tag[0] !== 'a') continue
      const hint = tag[2]?.trim()
      if (!hint || !/^wss?:\/\//i.test(hint)) continue
      const normalized = normalizeUrl(hint) || hint
      if (normalized) hints.add(normalized)
    }
  }
  return [...hints]
}

/**
 * WS/social relays for labels, comments, highlights, bookmarks, and pins.
 * Index-only HTTP relays (mercury, document mirrors) do not carry engagement kinds.
 */
export async function buildLibraryEngagementRelayUrls(
  userPubkey: string | undefined,
  indexRelayHints: string[],
  indexEvents: Event[] = [],
  blockedRelays: readonly string[] = []
): Promise<string[]> {
  const pubHints = collectPublicationRelayHints(indexEvents)
  const urls = await buildComprehensiveRelayList({
    userPubkey,
    relayHints: [...indexRelayHints, ...pubHints],
    includeUserOwnRelays: true,
    includeFastReadRelays: true,
    includeFavoriteRelays: true,
    includeProfileFetchRelays: true,
    includeSearchableRelays: false,
    includeViewerHttpIndexRelays: false,
    blockedRelays: [...blockedRelays]
  })
  return filterBlockedLibraryRelays(
    urls.map((u) => normalizeLibraryRelayUrl(u) || u).filter(Boolean),
    blockedRelays
  )
}

export type FetchLibraryIndexEventsOptions = {
  /** Called when IDB cache and each network batch are ready — unblocks the library grid early. */
  onProgress?: (events: Event[]) => void
  /** Skip deep pagination — only fetch the first page from each relay (enough to top up a short local cache). */
  firstPageOnly?: boolean
}

async function filterValidNewIndexEvents(
  incoming: Event[],
  knownIds: ReadonlySet<string>
): Promise<Event[]> {
  const novel = incoming.filter((event) => !knownIds.has(event.id))
  if (novel.length === 0) return []
  const out: Event[] = []
  for (let i = 0; i < novel.length; i += INDEX_VERIFY_CHUNK) {
    out.push(...filterValidIndexEvents(novel.slice(i, i + INDEX_VERIFY_CHUNK)))
    if (i + INDEX_VERIFY_CHUNK < novel.length) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
    }
  }
  return out
}

async function mergeValidIndexBatch(
  existing: PublicationIndexMap,
  knownIds: Set<string>,
  incoming: Event[]
): Promise<PublicationIndexMap> {
  const newValid = await filterValidNewIndexEvents(incoming, knownIds)
  if (newValid.length === 0) return existing
  for (const event of newValid) knownIds.add(event.id)
  return mergePublicationIndexMaps(existing, newValid)
}

export async function fetchLibraryIndexEvents(
  relayUrls: string[],
  options?: FetchLibraryIndexEventsOptions
): Promise<Event[]> {
  const indexRelays = libraryIndexRelayUrls(relayUrls)
  if (indexRelays.length === 0) return []

  const cached = await loadLibraryIndexCacheEvents()
  let indexMap = buildStructuralPublicationIndexMap(cached)
  let validMerged = publicationIndexMapValues(indexMap)
  const knownValidIds = new Set(validMerged.map((event) => event.id))
  const emitProgress = () => {
    options?.onProgress?.(validMerged)
  }
  emitProgress()

  const filter: Filter = { kinds: [ExtendedKind.PUBLICATION], limit: INDEX_WS_PAGE_LIMIT }
  const { wsRelays: rawWsRelays, httpRelays } = splitWsAndHttpRelays(indexRelays)
  const wsRelays = stripLocalNetworkRelaysForWssReq(rawWsRelays)

  const firstPageByRelay = new Map<string, Event[]>()
  const firstPagePromises: Promise<{ relay: string; events: Event[] }>[] = [
    ...wsRelays.map(async (wsRelay) => {
      const events = await fetchWsIndexFirstPage(wsRelay, filter)
      return { relay: wsRelay, events }
    }),
    ...httpRelays.map(async (httpRelay) => {
      const events = await fetchHttpIndexFirstPage(httpRelay, filter)
      return { relay: httpRelay, events }
    })
  ]

  const firstSettled = await Promise.allSettled(firstPagePromises)
  for (const result of firstSettled) {
    if (result.status !== 'fulfilled') continue
    firstPageByRelay.set(result.value.relay, result.value.events)
  }

  const firstPageNetwork = dedupeEventsById(
    firstSettled.flatMap((r) => (r.status === 'fulfilled' ? r.value.events : []))
  )
  indexMap = await mergeValidIndexBatch(indexMap, knownValidIds, firstPageNetwork)
  validMerged = publicationIndexMapValues(indexMap)
  void persistLibraryIndexCacheEvents(validMerged, { reconcile: false })
  emitProgress()

  if (import.meta.env.DEV) {
    const perRelayFirstPageCounts = firstSettled.map((r) =>
      r.status === 'fulfilled'
        ? { relay: r.value.relay, count: r.value.events.length }
        : { relay: 'unknown', count: 0 }
    )
    logger.info('[Library] index first page', {
      indexRelays: indexRelays.length,
      wsRelays: wsRelays.length,
      httpRelays: httpRelays.length,
      strippedWsRelays: rawWsRelays.length - wsRelays.length,
      cachedCount: cached.length,
      firstPageCount: firstPageNetwork.length,
      mergedCount: validMerged.length,
      validCount: validMerged.length,
      topLevelCount: getTopLevelIndexEvents(validMerged).length,
      perRelayCounts: perRelayFirstPageCounts
    })
  }

  if (!options?.firstPageOnly) {
    const deepBatches: Promise<{ relay: string; events: Event[] }>[] = []
    for (const wsRelay of wsRelays) {
      if (!isLibraryDeepIndexRelay(wsRelay)) continue
      deepBatches.push(
        fetchRemainingPagesFromWsIndexRelay(wsRelay, filter, firstPageByRelay.get(wsRelay) ?? []).then(
          (events) => ({ relay: wsRelay, events })
        )
      )
    }
    for (const httpRelay of httpRelays) {
      if (!isLibraryDeepIndexRelay(httpRelay)) continue
      deepBatches.push(
        fetchRemainingPagesFromHttpIndexRelay(
          httpRelay,
          filter,
          firstPageByRelay.get(httpRelay) ?? []
        ).then((events) => ({ relay: httpRelay, events }))
      )
    }

    const deepSettled = await Promise.allSettled(deepBatches)
    const deepNetwork = dedupeEventsById(
      deepSettled.flatMap((r) => (r.status === 'fulfilled' ? r.value.events : []))
    )
    indexMap = await mergeValidIndexBatch(indexMap, knownValidIds, deepNetwork)
    validMerged = publicationIndexMapValues(indexMap)
    void persistLibraryIndexCacheEvents(validMerged)
    emitProgress()

    if (import.meta.env.DEV) {
      const perRelayDeepCounts = deepSettled.map((r) =>
        r.status === 'fulfilled'
          ? { relay: r.value.relay, count: r.value.events.length }
          : { relay: 'unknown', count: 0 }
      )
      logger.info('[Library] index fetch complete', {
        deepPageCount: deepNetwork.length,
        mergedCount: validMerged.length,
        validCount: validMerged.length,
        topLevelCount: getTopLevelIndexEvents(validMerged).length,
        perRelayDeepCounts
      })
    }
  } else if (import.meta.env.DEV) {
    logger.info('[Library] index first page only', {
      mergedCount: validMerged.length,
      topLevelCount: getTopLevelIndexEvents(validMerged).length
    })
  }
  return validMerged
}

export function buildEngagementMapsFromEvents(
  labels: Event[],
  comments: Event[],
  highlights: Event[],
  targetAddresses?: Set<string>,
  targetEventIds?: Set<string>,
  viewerPubkey?: string | null,
  bookmarkLists: Event[] = [],
  pinLists: Event[] = []
): PublicationEngagementMaps {
  const labelAddresses = new Set<string>()
  const labelEventIds = new Set<string>()
  const labelValuesByAddress = new Map<string, Set<string>>()
  const labelValuesByEventId = new Map<string, Set<string>>()
  const booklistAddresses = new Set<string>()
  const booklistEventIds = new Set<string>()
  const myBooklistAddresses = new Set<string>()
  const myBooklistEventIds = new Set<string>()
  const myCommentAddresses = new Set<string>()
  const myCommentEventIds = new Set<string>()
  const myHighlightAddresses = new Set<string>()
  const myHighlightEventIds = new Set<string>()
  const commentAddresses = new Set<string>()
  const commentEventIds = new Set<string>()
  const highlightAddresses = new Set<string>()
  const highlightEventIds = new Set<string>()
  const bookmarkAddresses = new Set<string>()
  const bookmarkEventIds = new Set<string>()
  const pinAddresses = new Set<string>()
  const pinEventIds = new Set<string>()

  const addressMatches = (addr: string) => !targetAddresses || targetAddresses.has(addr)
  const eventIdMatches = (id: string) => !targetEventIds || targetEventIds.has(id.toLowerCase())
  const viewerPk = viewerPubkey?.trim().toLowerCase()

  const addLabelValues = (map: Map<string, Set<string>>, key: string, values: string[]) => {
    if (values.length === 0) return
    let set = map.get(key)
    if (!set) {
      set = new Set<string>()
      map.set(key, set)
    }
    for (const value of values) set.add(value)
  }

  for (const ev of labels) {
    const labelValues = extractNip32LabelValues(ev.tags)
    const isBooklist = labelValues.some(isBooklistNip32Label)
    const isViewerLabel = !!viewerPk && ev.pubkey.toLowerCase() === viewerPk
    for (const tag of ev.tags) {
      if (tag[0] === 'a' && tag[1] && addressMatches(tag[1])) {
        labelAddresses.add(tag[1])
        addLabelValues(labelValuesByAddress, tag[1], labelValues)
        if (isBooklist) {
          booklistAddresses.add(tag[1])
          if (isViewerLabel) myBooklistAddresses.add(tag[1])
        }
      }
      if (tag[0] === 'e' && tag[1] && eventIdMatches(tag[1])) {
        const eventId = tag[1].toLowerCase()
        labelEventIds.add(eventId)
        addLabelValues(labelValuesByEventId, eventId, labelValues)
        if (isBooklist) {
          booklistEventIds.add(eventId)
          if (isViewerLabel) myBooklistEventIds.add(eventId)
        }
      }
    }
  }

  for (const ev of comments) {
    const isViewerEvent = !!viewerPk && ev.pubkey.toLowerCase() === viewerPk
    for (const tag of ev.tags) {
      if (tag[0] === 'A' && tag[1] && addressMatches(tag[1])) {
        commentAddresses.add(tag[1])
        if (isViewerEvent) myCommentAddresses.add(tag[1])
      }
      if (tag[0] === 'e' && tag[1] && eventIdMatches(tag[1])) {
        commentEventIds.add(tag[1].toLowerCase())
        if (isViewerEvent) myCommentEventIds.add(tag[1].toLowerCase())
      }
    }
  }

  for (const ev of highlights) {
    const isViewerEvent = !!viewerPk && ev.pubkey.toLowerCase() === viewerPk
    for (const tag of ev.tags) {
      if (tag[0] === 'a' && tag[1] && addressMatches(tag[1])) {
        highlightAddresses.add(tag[1])
        if (isViewerEvent) myHighlightAddresses.add(tag[1])
      }
      if (tag[0] === 'e' && tag[1] && eventIdMatches(tag[1])) {
        highlightEventIds.add(tag[1].toLowerCase())
        if (isViewerEvent) myHighlightEventIds.add(tag[1].toLowerCase())
      }
    }
  }

  for (const ev of bookmarkLists) {
    for (const tag of ev.tags) {
      if (tag[0] === 'a' && tag[1] && addressMatches(tag[1])) {
        bookmarkAddresses.add(tag[1])
      }
      if (tag[0] === 'e' && tag[1] && eventIdMatches(tag[1])) {
        bookmarkEventIds.add(tag[1].toLowerCase())
      }
    }
  }

  for (const ev of pinLists) {
    for (const tag of ev.tags) {
      if (tag[0] === 'a' && tag[1] && addressMatches(tag[1])) {
        pinAddresses.add(tag[1])
      }
      if (tag[0] === 'e' && tag[1] && eventIdMatches(tag[1])) {
        pinEventIds.add(tag[1].toLowerCase())
      }
    }
  }

  return {
    labelAddresses,
    labelEventIds,
    labelValuesByAddress,
    labelValuesByEventId,
    booklistAddresses,
    booklistEventIds,
    myBooklistAddresses,
    myBooklistEventIds,
    myCommentAddresses,
    myCommentEventIds,
    myHighlightAddresses,
    myHighlightEventIds,
    commentAddresses,
    commentEventIds,
    highlightAddresses,
    highlightEventIds,
    bookmarkAddresses,
    bookmarkEventIds,
    pinAddresses,
    pinEventIds
  }
}

async function fetchHttpEngagementByAddresses(
  httpRelays: string[],
  kind: number,
  tagKey: '#a' | '#A',
  addressChunks: string[][]
): Promise<Event[]> {
  if (httpRelays.length === 0 || addressChunks.length === 0) return []
  const out: Event[] = []
  const seen = new Set<string>()
  for (const relay of httpRelays) {
    for (const chunk of addressChunks) {
      if (chunk.length === 0) continue
      const filter = {
        kinds: [kind],
        [tagKey]: chunk,
        limit: Math.min(chunk.length * 10, INDEX_HTTP_PAGE_LIMIT)
      } as Filter
      const batch = await queryIndexRelay(relay, filter)
      for (const ev of batch) {
        if (seen.has(ev.id)) continue
        seen.add(ev.id)
        out.push(ev)
      }
    }
  }
  return out
}

async function fetchHttpEngagementByEventIds(
  httpRelays: string[],
  kind: number,
  eventIdChunks: string[][]
): Promise<Event[]> {
  if (httpRelays.length === 0 || eventIdChunks.length === 0) return []
  const out: Event[] = []
  const seen = new Set<string>()
  for (const relay of httpRelays) {
    for (const chunk of eventIdChunks) {
      if (chunk.length === 0) continue
      const filter = {
        kinds: [kind],
        '#e': chunk,
        limit: Math.min(chunk.length * 10, INDEX_HTTP_PAGE_LIMIT)
      } as Filter
      const batch = await queryIndexRelay(relay, filter)
      for (const ev of batch) {
        if (seen.has(ev.id)) continue
        seen.add(ev.id)
        out.push(ev)
      }
    }
  }
  return out
}

export async function fetchPublicationEngagementMaps(
  relayUrls: string[],
  targetAddresses: Set<string>,
  targetEventIds: Set<string>,
  options?: { viewerPubkey?: string | null }
): Promise<PublicationEngagementMaps> {
  if (relayUrls.length === 0 || targetAddresses.size === 0) {
    return emptyPublicationEngagementMaps()
  }

  return withEngagementTimeout(
    fetchPublicationEngagementMapsInner(relayUrls, targetAddresses, targetEventIds, options),
    emptyPublicationEngagementMaps(),
    'maps'
  )
}

async function fetchPublicationEngagementMapsInner(
  relayUrls: string[],
  targetAddresses: Set<string>,
  targetEventIds: Set<string>,
  options?: { viewerPubkey?: string | null }
): Promise<PublicationEngagementMaps> {
  const addressChunks = limitEngagementChunks(chunkArray([...targetAddresses], ENGAGEMENT_ADDRESS_CHUNK))
  const eventIdChunks = limitEngagementChunks(chunkArray([...targetEventIds], ENGAGEMENT_EVENT_ID_CHUNK))
  const { wsRelays, httpRelays } = splitWsAndHttpRelays(relayUrls)
  const useWsEngagement = wsRelays.length > 0
  if (import.meta.env.DEV) {
    logger.info('[Library] engagement relay split', {
      wsRelays: wsRelays.length,
      httpRelays: httpRelays.length,
      targetAddresses: targetAddresses.size,
      targetEventIds: targetEventIds.size
    })
  }

  const highlightFilters = addressChunks.map(
    (chunk): Filter => ({ kinds: [kinds.Highlights], '#a': chunk, limit: chunk.length * 12 })
  )
  const labelAddressFilters = addressChunks.map(
    (chunk): Filter => ({ kinds: [ExtendedKind.LABEL], '#a': chunk, limit: chunk.length * 8 })
  )
  const labelEventFilters = eventIdChunks.map(
    (chunk): Filter => ({ kinds: [ExtendedKind.LABEL], '#e': chunk, limit: chunk.length * 6 })
  )
  const commentWsFilters = addressChunks.map(
    (chunk): Filter => ({ kinds: [ExtendedKind.COMMENT], '#A': chunk, limit: chunk.length * 12 })
  )
  const commentEventFilters = eventIdChunks.map(
    (chunk): Filter => ({ kinds: [ExtendedKind.COMMENT], '#e': chunk, limit: chunk.length * 12 })
  )
  const highlightEventFilters = eventIdChunks.map(
    (chunk): Filter => ({ kinds: [kinds.Highlights], '#e': chunk, limit: chunk.length * 12 })
  )
  const bookmarkAddressFilters = addressChunks.map(
    (chunk): Filter => ({ kinds: [kinds.BookmarkList], '#a': chunk, limit: chunk.length * 8 })
  )
  const bookmarkEventFilters = eventIdChunks.map(
    (chunk): Filter => ({ kinds: [kinds.BookmarkList], '#e': chunk, limit: chunk.length * 8 })
  )
  const pinAddressFilters = addressChunks.map(
    (chunk): Filter => ({ kinds: [PIN_LIST_KIND], '#a': chunk, limit: chunk.length * 8 })
  )
  const pinEventFilters = eventIdChunks.map(
    (chunk): Filter => ({ kinds: [PIN_LIST_KIND], '#e': chunk, limit: chunk.length * 8 })
  )

  const highlightPromise = Promise.all([
    useWsEngagement && highlightFilters.length > 0
      ? queryService.fetchEvents(wsRelays, highlightFilters, ENGAGEMENT_QUERY_OPTS)
      : Promise.resolve([] as Event[]),
    useWsEngagement && highlightEventFilters.length > 0
      ? queryService.fetchEvents(wsRelays, highlightEventFilters, ENGAGEMENT_QUERY_OPTS)
      : Promise.resolve([] as Event[]),
    fetchHttpEngagementByAddresses(httpRelays, kinds.Highlights, '#a', addressChunks),
    fetchHttpEngagementByEventIds(httpRelays, kinds.Highlights, eventIdChunks)
  ]).then(([scoped, byEvent, bulkAddress, bulkEvent]) =>
    dedupeEventsById([...scoped, ...byEvent, ...bulkAddress, ...bulkEvent])
  )

  const labelPromise = Promise.all([
    useWsEngagement && labelAddressFilters.length > 0
      ? queryService.fetchEvents(wsRelays, labelAddressFilters, ENGAGEMENT_QUERY_OPTS)
      : Promise.resolve([] as Event[]),
    useWsEngagement && labelEventFilters.length > 0
      ? queryService.fetchEvents(wsRelays, labelEventFilters, ENGAGEMENT_QUERY_OPTS)
      : Promise.resolve([] as Event[]),
    fetchHttpEngagementByAddresses(httpRelays, ExtendedKind.LABEL, '#a', addressChunks),
    fetchHttpEngagementByEventIds(httpRelays, ExtendedKind.LABEL, eventIdChunks)
  ]).then(([byAddress, byEvent, bulkAddress, bulkEvent]) =>
    dedupeEventsById([...byAddress, ...byEvent, ...bulkAddress, ...bulkEvent])
  )

  const commentPromise = Promise.all([
    useWsEngagement && commentWsFilters.length > 0
      ? queryService.fetchEvents(wsRelays, commentWsFilters, ENGAGEMENT_QUERY_OPTS)
      : Promise.resolve([] as Event[]),
    useWsEngagement && commentEventFilters.length > 0
      ? queryService.fetchEvents(wsRelays, commentEventFilters, ENGAGEMENT_QUERY_OPTS)
      : Promise.resolve([] as Event[]),
    fetchHttpEngagementByAddresses(httpRelays, ExtendedKind.COMMENT, '#A', addressChunks),
    fetchHttpEngagementByEventIds(httpRelays, ExtendedKind.COMMENT, eventIdChunks)
  ]).then(([scoped, byEvent, bulkAddress, bulkEvent]) =>
    dedupeEventsById([...scoped, ...byEvent, ...bulkAddress, ...bulkEvent])
  )

  const bookmarkPromise = Promise.all([
    useWsEngagement && bookmarkAddressFilters.length > 0
      ? queryService.fetchEvents(wsRelays, bookmarkAddressFilters, ENGAGEMENT_QUERY_OPTS)
      : Promise.resolve([] as Event[]),
    useWsEngagement && bookmarkEventFilters.length > 0
      ? queryService.fetchEvents(wsRelays, bookmarkEventFilters, ENGAGEMENT_QUERY_OPTS)
      : Promise.resolve([] as Event[]),
    fetchHttpEngagementByAddresses(httpRelays, kinds.BookmarkList, '#a', addressChunks),
    fetchHttpEngagementByEventIds(httpRelays, kinds.BookmarkList, eventIdChunks)
  ]).then(([byAddress, byEvent, bulkAddress, bulkEvent]) =>
    dedupeEventsById([...byAddress, ...byEvent, ...bulkAddress, ...bulkEvent])
  )

  const pinPromise = Promise.all([
    useWsEngagement && pinAddressFilters.length > 0
      ? queryService.fetchEvents(wsRelays, pinAddressFilters, ENGAGEMENT_QUERY_OPTS)
      : Promise.resolve([] as Event[]),
    useWsEngagement && pinEventFilters.length > 0
      ? queryService.fetchEvents(wsRelays, pinEventFilters, ENGAGEMENT_QUERY_OPTS)
      : Promise.resolve([] as Event[]),
    fetchHttpEngagementByAddresses(httpRelays, PIN_LIST_KIND, '#a', addressChunks),
    fetchHttpEngagementByEventIds(httpRelays, PIN_LIST_KIND, eventIdChunks)
  ]).then(([byAddress, byEvent, bulkAddress, bulkEvent]) =>
    dedupeEventsById([...byAddress, ...byEvent, ...bulkAddress, ...bulkEvent])
  )

  const [highlights, labels, comments, bookmarkLists, pinLists] = await Promise.all([
    highlightPromise,
    labelPromise,
    commentPromise,
    bookmarkPromise,
    pinPromise
  ])

  return buildEngagementMapsFromEvents(
    dedupeEventsById(labels),
    dedupeEventsById(comments),
    dedupeEventsById(highlights),
    targetAddresses,
    targetEventIds,
    options?.viewerPubkey,
    dedupeEventsById(bookmarkLists),
    dedupeEventsById(pinLists)
  )
}

function addressHasEngagement(
  address: string,
  eventId: string | undefined,
  maps: PublicationEngagementMaps
): { hasLabel: boolean; hasComment: boolean; hasHighlight: boolean } {
  const idLower = eventId?.toLowerCase()
  const hasLabel =
    maps.labelAddresses.has(address) || (idLower ? maps.labelEventIds.has(idLower) : false)
  const hasComment =
    maps.commentAddresses.has(address) || (idLower ? maps.commentEventIds.has(idLower) : false)
  const hasHighlight =
    maps.highlightAddresses.has(address) || (idLower ? maps.highlightEventIds.has(idLower) : false)
  return { hasLabel, hasComment, hasHighlight }
}

function collectBookmarkPinFlagsForTarget(
  address: string,
  eventId: string | undefined,
  maps: PublicationEngagementMaps
): { hasBookmark: boolean; hasPin: boolean } {
  const idLower = eventId?.toLowerCase()
  return {
    hasBookmark:
      maps.bookmarkAddresses.has(address) || (idLower ? maps.bookmarkEventIds.has(idLower) : false),
    hasPin: maps.pinAddresses.has(address) || (idLower ? maps.pinEventIds.has(idLower) : false)
  }
}

function targetHasPublicationEngagement(
  flags: { hasLabel: boolean; hasComment: boolean; hasHighlight: boolean },
  booklistFlags: { hasBooklistLabel: boolean },
  bookmarkPinFlags: { hasBookmark: boolean; hasPin: boolean }
): boolean {
  return (
    flags.hasLabel ||
    flags.hasComment ||
    flags.hasHighlight ||
    booklistFlags.hasBooklistLabel ||
    bookmarkPinFlags.hasBookmark ||
    bookmarkPinFlags.hasPin
  )
}

/** True when a library row has any engagement signal from any author. */
export function publicationEntryHasEngagement(entry: LibraryPublicationEntry): boolean {
  return (
    entry.hasLabel ||
    entry.hasBooklistLabel ||
    entry.hasComment ||
    entry.hasHighlight ||
    entry.hasBookmark ||
    entry.hasPin
  )
}

function collectLabelNamesForTarget(
  address: string,
  eventId: string | undefined,
  maps: PublicationEngagementMaps,
  out: Set<string>
): void {
  const byAddress = maps.labelValuesByAddress.get(address)
  if (byAddress) {
    for (const value of byAddress) {
      if (!isBooklistNip32Label(value)) out.add(value)
    }
  }
  if (eventId) {
    const byEventId = maps.labelValuesByEventId.get(eventId.toLowerCase())
    if (byEventId) {
      for (const value of byEventId) {
        if (!isBooklistNip32Label(value)) out.add(value)
      }
    }
  }
}

function collectBooklistFlagsForTarget(
  address: string,
  eventId: string | undefined,
  maps: PublicationEngagementMaps
): { hasBooklistLabel: boolean; hasMyBooklistLabel: boolean } {
  const hasBooklistLabel =
    maps.booklistAddresses.has(address) ||
    (eventId ? maps.booklistEventIds.has(eventId.toLowerCase()) : false)
  const hasMyBooklistLabel =
    maps.myBooklistAddresses.has(address) ||
    (eventId ? maps.myBooklistEventIds.has(eventId.toLowerCase()) : false)
  return { hasBooklistLabel, hasMyBooklistLabel }
}

function collectMyEngagementFlagsForTarget(
  address: string,
  eventId: string | undefined,
  maps: PublicationEngagementMaps
): { hasMyComment: boolean; hasMyHighlight: boolean } {
  const hasMyComment =
    maps.myCommentAddresses.has(address) ||
    (eventId ? maps.myCommentEventIds.has(eventId.toLowerCase()) : false)
  const hasMyHighlight =
    maps.myHighlightAddresses.has(address) ||
    (eventId ? maps.myHighlightEventIds.has(eventId.toLowerCase()) : false)
  return { hasMyComment, hasMyHighlight }
}

/** Build one library row with engagement/booklist flags for a top-level kind-30040 root. */
export function buildLibraryPublicationEntry(
  root: Event,
  indexByAddress: Map<string, Event>,
  engagement: PublicationEngagementMaps
): LibraryPublicationEntry {
  const reachable = collectReachableAddressesCached(root, indexByAddress)
  const rootAddr = eventTagAddress(root)
  if (rootAddr) reachable.add(rootAddr)

  let hasLabel = false
  let hasComment = false
  let hasHighlight = false
  let hasBookmark = false
  let hasPin = false
  let hasBooklistLabel = false
  let hasMyBooklistLabel = false
  let hasMyComment = false
  let hasMyHighlight = false
  let engagementCount = 0
  const labelNames = new Set<string>()

  for (const addr of reachable) {
    const indexed = indexByAddress.get(addr)
    const flags = addressHasEngagement(addr, indexed?.id, engagement)
    const booklistFlags = collectBooklistFlagsForTarget(addr, indexed?.id, engagement)
    const bookmarkPinFlags = collectBookmarkPinFlagsForTarget(addr, indexed?.id, engagement)
    const myFlags = collectMyEngagementFlagsForTarget(addr, indexed?.id, engagement)
    if (flags.hasLabel) {
      hasLabel = true
      collectLabelNamesForTarget(addr, indexed?.id, engagement, labelNames)
    }
    if (booklistFlags.hasBooklistLabel) hasBooklistLabel = true
    if (booklistFlags.hasMyBooklistLabel) hasMyBooklistLabel = true
    if (myFlags.hasMyComment) hasMyComment = true
    if (myFlags.hasMyHighlight) hasMyHighlight = true
    if (flags.hasComment) hasComment = true
    if (flags.hasHighlight) hasHighlight = true
    if (bookmarkPinFlags.hasBookmark) hasBookmark = true
    if (bookmarkPinFlags.hasPin) hasPin = true
    if (targetHasPublicationEngagement(flags, booklistFlags, bookmarkPinFlags)) engagementCount++
  }

  const rootFlags = addressHasEngagement(rootAddr ?? '', root.id, engagement)
  const rootBooklistFlags = collectBooklistFlagsForTarget(rootAddr ?? '', root.id, engagement)
  const rootBookmarkPinFlags = collectBookmarkPinFlagsForTarget(rootAddr ?? '', root.id, engagement)
  const rootMyFlags = collectMyEngagementFlagsForTarget(rootAddr ?? '', root.id, engagement)
  hasLabel = hasLabel || rootFlags.hasLabel
  hasComment = hasComment || rootFlags.hasComment
  hasHighlight = hasHighlight || rootFlags.hasHighlight
  hasBookmark = hasBookmark || rootBookmarkPinFlags.hasBookmark
  hasPin = hasPin || rootBookmarkPinFlags.hasPin
  hasBooklistLabel = hasBooklistLabel || rootBooklistFlags.hasBooklistLabel
  hasMyBooklistLabel = hasMyBooklistLabel || rootBooklistFlags.hasMyBooklistLabel
  hasMyComment = hasMyComment || rootMyFlags.hasMyComment
  hasMyHighlight = hasMyHighlight || rootMyFlags.hasMyHighlight
  if (rootFlags.hasLabel) {
    collectLabelNamesForTarget(rootAddr ?? '', root.id, engagement, labelNames)
  }

  return {
    event: root,
    hasLabel,
    labelNames: [...labelNames].sort((a, b) => a.localeCompare(b)),
    hasBooklistLabel,
    hasMyBooklistLabel,
    hasMyComment,
    hasMyHighlight,
    hasComment,
    hasHighlight,
    hasBookmark,
    hasPin,
    engagementCount
  }
}

export function libraryPublicationEntriesFromIndex(
  indexEvents: Event[],
  engagement: PublicationEngagementMaps
): LibraryPublicationEntry[] {
  const indexByAddress = buildIndexByAddress(indexEvents)
  return getTopLevelIndexEvents(indexEvents).map((root) =>
    buildLibraryPublicationEntry(root, indexByAddress, engagement)
  )
}

export function filterEngagedPublications(
  roots: Event[],
  indexByAddress: Map<string, Event>,
  engagement: PublicationEngagementMaps
): LibraryPublicationEntry[] {
  return getTopLevelIndexEvents(roots)
    .map((root) => buildLibraryPublicationEntry(root, indexByAddress, engagement))
    .filter((entry) => publicationEntryHasEngagement(entry))
}

export function buildRecentPublicationEntries(
  roots: Event[],
  indexByAddress: Map<string, Event>,
  engagement: PublicationEngagementMaps,
  limit = LIBRARY_PAGE_SIZE
): LibraryPublicationEntry[] {
  return [...getTopLevelIndexEvents(roots)]
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((event) => buildLibraryPublicationEntry(event, indexByAddress, engagement))
}

/** Default feed order: newest top-level indexes first. */
export function computeLibraryFeedRootOrder(
  roots: Event[],
  _indexByAddress: Map<string, Event>,
  _engagement: PublicationEngagementMaps
): Event[] {
  const seen = new Set<string>()
  const ordered: Event[] = []
  for (const root of [...getTopLevelIndexEvents(roots)].sort((a, b) => b.created_at - a.created_at)) {
    const dedupeKey = eventTagAddress(root) ?? root.id
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    ordered.push(root)
  }
  return ordered
}

/** Entries for default library feed from page 0 through {@link pageIndexInclusive} (inclusive). */
export function libraryFeedEntriesThroughPage(
  orderedRoots: Event[],
  indexByAddress: Map<string, Event>,
  engagement: PublicationEngagementMaps,
  pageIndexInclusive: number,
  pageSize = LIBRARY_PAGE_SIZE
): LibraryPublicationEntry[] {
  const end = Math.min(orderedRoots.length, (pageIndexInclusive + 1) * pageSize)
  return orderedRoots
    .slice(0, end)
    .map((root) => buildLibraryPublicationEntry(root, indexByAddress, engagement))
}

export function libraryDefaultFeedSlice(
  indexEvents: Event[],
  engagement: PublicationEngagementMaps,
  pageIndexInclusive: number
): {
  entries: LibraryPublicationEntry[]
  totalCount: number
  hasMore: boolean
} {
  if (indexEvents.length === 0) {
    return { entries: [], totalCount: 0, hasMore: false }
  }
  const indexByAddress = buildIndexByAddress(indexEvents)
  const ordered = computeLibraryFeedRootOrder(indexEvents, indexByAddress, engagement)
  const entries = libraryFeedEntriesThroughPage(
    ordered,
    indexByAddress,
    engagement,
    pageIndexInclusive
  )
  return {
    entries,
    totalCount: ordered.length,
    hasMore: entries.length < ordered.length
  }
}

/** First page of the default library feed (newest top-level indexes). */
export function pickLibraryPublicationEntries(
  roots: Event[],
  indexByAddress: Map<string, Event>,
  engagement: PublicationEngagementMaps
): LibraryPublicationEntry[] {
  return buildRecentPublicationEntries(roots, indexByAddress, engagement, LIBRARY_PAGE_SIZE)
}

export function sortLibraryPublications(entries: LibraryPublicationEntry[]): LibraryPublicationEntry[] {
  return [...entries].sort((a, b) => b.event.created_at - a.event.created_at)
}

/** Search results: best content phrase match first, then other content hits, then metadata. */
export function sortLibrarySearchPublications(entries: LibraryPublicationEntry[]): LibraryPublicationEntry[] {
  return [...entries].sort((a, b) => {
    const aScore = a.contentSearchMatch?.matchScore ?? 0
    const bScore = b.contentSearchMatch?.matchScore ?? 0
    if (aScore !== bScore) return bScore - aScore
    return b.event.created_at - a.event.created_at
  })
}

const EMPTY_ENGAGEMENT = emptyPublicationEngagementMaps()

function emptyPublicationEngagementMaps(): PublicationEngagementMaps {
  return {
    labelAddresses: new Set(),
    labelEventIds: new Set(),
    labelValuesByAddress: new Map(),
    labelValuesByEventId: new Map(),
    booklistAddresses: new Set(),
    booklistEventIds: new Set(),
    myBooklistAddresses: new Set(),
    myBooklistEventIds: new Set(),
    myCommentAddresses: new Set(),
    myCommentEventIds: new Set(),
    myHighlightAddresses: new Set(),
    myHighlightEventIds: new Set(),
    commentAddresses: new Set(),
    commentEventIds: new Set(),
    highlightAddresses: new Set(),
    highlightEventIds: new Set(),
    bookmarkAddresses: new Set(),
    bookmarkEventIds: new Set(),
    pinAddresses: new Set(),
    pinEventIds: new Set()
  }
}

function isEventInBookmarkList(bookmarkList: Event, event: Event): boolean {
  const isReplaceable = isReplaceableEvent(event.kind)
  const eventKey = isReplaceable ? getReplaceableCoordinateFromEvent(event) : event.id
  return bookmarkList.tags.some((tag) =>
    isReplaceable ? tag[0] === 'a' && tag[1] === eventKey : tag[0] === 'e' && tag[1] === eventKey
  )
}

export function publicationEntryBelongsToUser(
  entry: LibraryPublicationEntry,
  opts: {
    userPubkey: string
    bookmarkListEvent?: Event | null
    pinListEvent?: Event | null
    myBooklistAddresses?: Set<string>
    myBooklistEventIds?: Set<string>
  }
): boolean {
  const { event } = entry
  const pk = opts.userPubkey.toLowerCase()
  const rootAddr = eventTagAddress(event)
  if (event.pubkey.toLowerCase() === pk) return true
  if (event.tags.some((t) => t[0] === 'p' && t[1]?.toLowerCase() === pk)) return true
  if (entry.hasMyBooklistLabel || entry.hasMyComment || entry.hasMyHighlight) return true
  if (rootAddr && opts.myBooklistAddresses?.has(rootAddr)) return true
  if (opts.myBooklistEventIds?.has(event.id.toLowerCase())) return true
  if (opts.bookmarkListEvent && isEventInBookmarkList(opts.bookmarkListEvent, event)) return true
  if (opts.pinListEvent && isEventInPinList(opts.pinListEvent, event)) return true
  return false
}

export type LibraryMineFilterOpts = {
  bookmarkListEvent?: Event | null
  pinListEvent?: Event | null
  myBooklistAddresses?: Set<string>
  myBooklistEventIds?: Set<string>
}

/** Cheap membership test on a top-level index — no full {@link LibraryPublicationEntry} build. */
export function publicationRootBelongsToUser(
  root: Event,
  indexByAddress: Map<string, Event>,
  engagement: PublicationEngagementMaps,
  userPubkey: string,
  opts?: LibraryMineFilterOpts
): boolean {
  const pk = userPubkey.toLowerCase()
  if (root.pubkey.toLowerCase() === pk) return true
  if (root.tags.some((t) => t[0] === 'p' && t[1]?.toLowerCase() === pk)) return true
  const rootAddr = eventTagAddress(root)
  if (rootAddr && opts?.myBooklistAddresses?.has(rootAddr)) return true
  if (opts?.myBooklistEventIds?.has(root.id.toLowerCase())) return true
  if (opts?.bookmarkListEvent && isEventInBookmarkList(opts.bookmarkListEvent, root)) return true
  if (opts?.pinListEvent && isEventInPinList(opts.pinListEvent, root)) return true

  const reachable = collectReachableAddressesCached(root, indexByAddress)
  if (rootAddr) reachable.add(rootAddr)
  for (const addr of reachable) {
    const indexed = indexByAddress.get(addr)
    const eventId = indexed?.id ?? (addr === rootAddr ? root.id : undefined)
    if (collectBooklistFlagsForTarget(addr, eventId, engagement).hasMyBooklistLabel) return true
    const myFlags = collectMyEngagementFlagsForTarget(addr, eventId, engagement)
    if (myFlags.hasMyComment || myFlags.hasMyHighlight) return true
  }
  return false
}

const MINE_FILTER_BATCH_SIZE = 40

/** Build library rows only for publications belonging to the viewer (fast path for “My publications”). */
export function libraryPublicationEntriesForUserFromIndex(
  indexEvents: Event[],
  engagement: PublicationEngagementMaps,
  userPubkey: string,
  opts?: LibraryMineFilterOpts
): LibraryPublicationEntry[] {
  if (!userPubkey) return []
  const indexByAddress = buildIndexByAddress(indexEvents)
  const out: LibraryPublicationEntry[] = []
  for (const root of getTopLevelIndexEvents(indexEvents)) {
    if (!publicationRootBelongsToUser(root, indexByAddress, engagement, userPubkey, opts)) continue
    out.push(buildLibraryPublicationEntry(root, indexByAddress, engagement))
  }
  return sortLibraryPublications(out)
}

/** Yields between root batches so the UI stays responsive on large indexes. */
export function libraryPublicationEntriesForUserFromIndexAsync(
  indexEvents: Event[],
  engagement: PublicationEngagementMaps,
  userPubkey: string,
  opts?: LibraryMineFilterOpts,
  signal?: { cancelled: boolean }
): Promise<LibraryPublicationEntry[]> {
  if (!userPubkey) return Promise.resolve([])
  const indexByAddress = buildIndexByAddress(indexEvents)
  const roots = getTopLevelIndexEvents(indexEvents)
  const out: LibraryPublicationEntry[] = []
  let i = 0

  return new Promise((resolve) => {
    const step = () => {
      if (signal?.cancelled) return
      const end = Math.min(i + MINE_FILTER_BATCH_SIZE, roots.length)
      for (; i < end; i++) {
        const root = roots[i]
        if (!publicationRootBelongsToUser(root, indexByAddress, engagement, userPubkey, opts)) continue
        out.push(buildLibraryPublicationEntry(root, indexByAddress, engagement))
      }
      if (signal?.cancelled) return
      if (i < roots.length) {
        requestAnimationFrame(step)
      } else {
        resolve(sortLibraryPublications(out))
      }
    }
    requestAnimationFrame(step)
  })
}

/** Haystack for kind-30040 index search: metadata tags plus section refs and language tags (no content). */
export function publicationIndexSearchHaystack(event: Event): string {
  const base = metadataSearchHaystack(event)
  if (event.kind !== ExtendedKind.PUBLICATION) return base

  const extra: string[] = []
  for (const tag of event.tags ?? []) {
    const name = (tag[0] || '').trim().toLowerCase()
    if (name === 'l' && tag[1]?.trim()) {
      extra.push(tag[1].trim())
    } else if (name === 'a') {
      const coord = tag[1]?.trim()
      if (coord) extra.push(coord.replace(/:/g, ' ').replace(/-/g, ' '))
      const label = tag[3]?.trim() || (tag[2]?.trim() && !/^wss?:\/\//i.test(tag[2]) ? tag[2].trim() : '')
      if (label) extra.push(label)
    }
  }
  if (extra.length === 0) return base
  return `${base}\n${extra.join('\n')}`.toLowerCase()
}

export function publicationIndexMatchesSearchQuery(event: Event, query: string): boolean {
  if (event.kind !== ExtendedKind.PUBLICATION) return false

  const raw = query.trim()
  if (!raw) return false

  const decodedAuthor = decodeProfileSearchQueryToPubkeyHex(raw)
  if (decodedAuthor && event.pubkey.toLowerCase() === decodedAuthor) return true

  const eventId = tryParseCitationEventIdFromQuery(raw)
  if (eventId && event.id.toLowerCase() === eventId) return true

  const haystack = publicationIndexSearchHaystack(event)
  if (isQuotedSearchQuery(raw)) {
    return haystackMatchesPhraseQuery(haystack, raw)
  }
  return haystackMatchesSearchQuery(haystack, raw)
}

function buildAddressToRootMap(
  topLevel: Event[],
  indexByAddress: Map<string, Event>
): Map<string, Event> {
  const map = new Map<string, Event>()
  for (const root of topLevel) {
    const rootAddr = eventTagAddress(root)
    if (rootAddr) map.set(rootAddr, root)
    for (const addr of collectReachableAddressesCached(root, indexByAddress)) {
      map.set(addr, root)
    }
  }
  return map
}

function findPublicationRootForContentAddress(
  contentAddress: string,
  indexEvents: Event[],
  indexByAddress: Map<string, Event>
): Event | undefined {
  const topLevel = getTopLevelIndexEvents(indexEvents)
  const addressToRoot = buildAddressToRootMap(topLevel, indexByAddress)
  return addressToRoot.get(contentAddress)
}

/** Map kind-30041 content hits to top-level kind-30040 publication roots via `a` tag refs. */
export function findLibraryPublicationContentSearchMatches(
  query: string,
  contentEvents: Event[],
  indexEvents: Event[],
  indexByAddress: Map<string, Event>
): Array<{ root: Event; match: LibraryPublicationContentSearchMatch }> {
  const q = query.trim()
  if (!q || contentEvents.length === 0 || indexEvents.length === 0) return []

  const matches: Array<{ root: Event; match: LibraryPublicationContentSearchMatch }> = []
  const bestByRootId = new Map<string, LibraryPublicationContentSearchMatch>()

  for (const ev of contentEvents) {
    if (ev.kind !== ExtendedKind.PUBLICATION_CONTENT) continue
    const matchScore = scorePublicationContentEventSearchQuery(ev, q)
    if (matchScore <= 0) continue

    const addr = eventTagAddress(ev)
    if (!addr) continue
    const root = findPublicationRootForContentAddress(addr, indexEvents, indexByAddress)
    if (!root) continue

    const prev = bestByRootId.get(root.id)
    if (prev && prev.matchScore >= matchScore) continue

    bestByRootId.set(root.id, {
      sectionAddress: addr,
      highlightQuery: q,
      contentEvent: ev,
      matchScore
    })
  }

  for (const [rootId, match] of bestByRootId) {
    const root = findPublicationRootForContentAddress(match.sectionAddress, indexEvents, indexByAddress)
    if (!root || root.id !== rootId) continue
    matches.push({ root, match })
  }

  return matches.sort((a, b) => b.match.matchScore - a.match.matchScore)
}

/**
 * DEV-only funnel report for the local full-text path: scan → phrase match → mappable address → root.
 * Pinpoints where a "stored locally" excerpt drops out (not in cache, phrase mismatch, or no kind-30040
 * index to map the section to a publication).
 */
function diagnoseLocalContentSearch(
  query: string,
  contentEvents: Event[],
  ctx: { contentPrimary: boolean; cachedIndexCount: number; mappedRoots: number }
): void {
  const q = query.trim()
  const sections = contentEvents.filter((ev) => ev.kind === ExtendedKind.PUBLICATION_CONTENT)
  // `scoreMatched` includes scattered-word noise; `phraseMatched` is the strict contiguous-quote match
  // that contentPrimary results actually require, so a big gap means the relevant section was crowded out.
  const scoreMatched = sections.filter((ev) => scorePublicationContentEventSearchQuery(ev, q) > 0)
  const phraseMatched = sections.filter((ev) => haystackMatchesPhraseQuery(publicationContentSectionHaystack(ev), q))
  const matchedWithAddress = phraseMatched.filter((ev) => !!eventTagAddress(ev))

  const sampleUnmapped =
    ctx.mappedRoots === 0 && matchedWithAddress.length > 0
      ? matchedWithAddress.slice(0, 3).map((ev) => ({
          d: ev.tags?.find((t) => t[0] === 'd')?.[1] ?? '',
          a: ev.tags?.find((t) => t[0] === 'a')?.[1] ?? '',
          title: publicationContentSectionTitle(ev)
        }))
      : undefined

  logger.info('[Library] local content funnel', {
    query: q.length > 60 ? `${q.slice(0, 60)}…` : q,
    contentPrimary: ctx.contentPrimary,
    scanned: sections.length,
    scoreMatched: scoreMatched.length,
    phraseMatched: phraseMatched.length,
    matchedWithAddress: matchedWithAddress.length,
    cachedIndexEvents: ctx.cachedIndexCount,
    mappedRoots: ctx.mappedRoots,
    ...(sampleUnmapped ? { unmappedSampleSections: sampleUnmapped } : {})
  })
}

export function libraryPublicationRootsForContentEvents(
  query: string,
  contentEvents: Event[],
  indexEvents: Event[],
  indexByAddress: Map<string, Event>
): Event[] {
  return findLibraryPublicationContentSearchMatches(query, contentEvents, indexEvents, indexByAddress).map(
    ({ root }) => root
  )
}

function libraryEntriesFromRoots(
  roots: Event[],
  indexByAddress: Map<string, Event>,
  engagement: PublicationEngagementMaps,
  contentMatchesByRootId?: Map<string, LibraryPublicationContentSearchMatch>
): LibraryPublicationEntry[] {
  return roots.map((root) => {
    const entry = buildLibraryPublicationEntry(root, indexByAddress, engagement)
    const contentSearchMatch = contentMatchesByRootId?.get(root.id)
    return contentSearchMatch ? { ...entry, contentSearchMatch } : entry
  })
}

const LIBRARY_SEARCH_BATCH_SIZE = 80

function collectLibraryPublicationIndexSearchRoots(
  query: string,
  indexEvents: Event[],
  topLevelIds: Set<string>,
  addressToRoot: Map<string, Event>,
  axis: LibraryPublicationRelaySearchAxis | null | undefined,
  roots: Map<string, Event>,
  start: number,
  end: number
): void {
  const q = query.trim()

  for (let i = start; i < end; i++) {
    const ev = indexEvents[i]
    if (ev.kind !== ExtendedKind.PUBLICATION) continue
    if (!publicationIndexMatchesSearchQueryWithAxis(ev, q, axis)) continue

    if (topLevelIds.has(ev.id)) {
      roots.set(ev.id, ev)
      continue
    }

    const addr = eventTagAddress(ev)
    const root = addr ? addressToRoot.get(addr) : undefined
    if (root) roots.set(root.id, root)
  }
}

/** Search all cached kind-30040 indexes (library index store), mapping nested hits to top-level roots. */
export function searchLibraryPublicationIndex(
  query: string,
  indexEvents: Event[],
  indexByAddress: Map<string, Event>,
  axis?: LibraryPublicationRelaySearchAxis | null
): Event[] {
  const q = query.trim()
  if (!q || indexEvents.length === 0) return []

  const topLevel = getTopLevelIndexEvents(indexEvents)
  const topLevelIds = new Set(topLevel.map((ev) => ev.id))
  const addressToRoot = buildAddressToRootMap(topLevel, indexByAddress)
  const roots = new Map<string, Event>()
  collectLibraryPublicationIndexSearchRoots(
    q,
    indexEvents,
    topLevelIds,
    addressToRoot,
    axis,
    roots,
    0,
    indexEvents.length
  )
  return [...roots.values()]
}

/** Yields between batches so large index scans do not freeze the UI. */
export function searchLibraryPublicationIndexAsync(
  query: string,
  indexEvents: Event[],
  indexByAddress: Map<string, Event>,
  axis?: LibraryPublicationRelaySearchAxis | null,
  options?: { signal?: { cancelled: boolean }; onProgress?: (roots: Event[]) => void }
): Promise<Event[]> {
  const q = query.trim()
  if (!q || indexEvents.length === 0) return Promise.resolve([])

  const topLevel = getTopLevelIndexEvents(indexEvents)
  const topLevelIds = new Set(topLevel.map((ev) => ev.id))
  const addressToRoot = buildAddressToRootMap(topLevel, indexByAddress)
  const roots = new Map<string, Event>()
  let i = 0
  const signal = options?.signal

  return new Promise((resolve) => {
    const step = () => {
      if (signal?.cancelled) return
      const end = Math.min(i + LIBRARY_SEARCH_BATCH_SIZE, indexEvents.length)
      collectLibraryPublicationIndexSearchRoots(
        q,
        indexEvents,
        topLevelIds,
        addressToRoot,
        axis,
        roots,
        i,
        end
      )
      i = end
      if (signal?.cancelled) return
      options?.onProgress?.([...roots.values()])
      if (i < indexEvents.length) {
        requestAnimationFrame(step)
      } else {
        resolve([...roots.values()])
      }
    }
    requestAnimationFrame(step)
  })
}

export type LibrarySearchProgress = {
  entries: LibraryPublicationEntry[]
  mergedIndexEvents?: Event[]
  networkEventCount?: number
}

export type LibrarySearchContext = {
  indexEvents: Event[]
  engagement?: PublicationEngagementMaps
}

/**
 * Search publications across the library index cache (all loaded kind-30040 rows), the
 * publication reading cache ({@link StoreNames.PUBLICATION_EVENTS}), and kind-30041 section
 * body text (content only, mapped back to top-level roots).
 */
export async function searchLibraryPublications(
  query: string,
  context: LibrarySearchContext,
  axis?: LibraryPublicationRelaySearchAxis | null,
  options?: { onProgress?: (progress: LibrarySearchProgress) => void; forceRefresh?: boolean }
): Promise<LibraryPublicationEntry[]> {
  const q = query.trim()
  if (!q) return []

  const contentPrimary = !axis && shouldSearchPublicationContentOnRelays(q)

  const report = (
    roots: Event[],
    indexEvents: Event[],
    contentMatches?: Map<string, LibraryPublicationContentSearchMatch>
  ) => {
    const indexByAddress = buildIndexByAddress(indexEvents)
    const sortedEntries = sortLibrarySearchPublications(
      libraryEntriesFromRoots(roots, indexByAddress, context.engagement ?? EMPTY_ENGAGEMENT, contentMatches)
    )
    const phraseEntries = sortedEntries.filter(
      (entry) => (entry.contentSearchMatch?.matchScore ?? 0) >= 10_000
    )
    // For passage/content searches, only true phrase matches count — never fall back to scattered-word
    // matches (those surface unrelated long books). No phrase match => empty, matching the relay path.
    const entries = contentPrimary ? phraseEntries : sortedEntries
    options?.onProgress?.({ entries, mergedIndexEvents: indexEvents })
    return entries
  }

  if (!options?.forceRefresh) {
    const cached = getLibrarySearchSessionRow(q, context, { axis })
    if (cached && isServableLibrarySearchSessionRow(cached, q, axis)) {
      if (import.meta.env.DEV) {
        logger.info('[Library] search cache hit', {
          query: q,
          axis: axis ?? 'all',
          relaySearched: cached.relaySearched
        })
      }
      options?.onProgress?.({ entries: cached.entries, mergedIndexEvents: cached.mergedIndexEvents })
      return cached.entries
    }
  }

  let indexEvents = context.indexEvents
  if (indexEvents.length === 0) {
    indexEvents = await loadLibraryIndexCacheEvents()
  }

  const engagement = context.engagement ?? EMPTY_ENGAGEMENT
  const indexByAddress = buildIndexByAddress(indexEvents)
  const contentMatchesByRootId = new Map<string, LibraryPublicationContentSearchMatch>()
  const rootMap = new Map<string, Event>()

  if (!contentPrimary) {
    const fromIndex = await searchLibraryPublicationIndexAsync(q, indexEvents, indexByAddress, axis, {
      onProgress: (roots) => {
        for (const root of roots) rootMap.set(root.id, root)
        report([...rootMap.values()], indexEvents, contentMatchesByRootId)
      }
    })
    for (const root of fromIndex) rootMap.set(root.id, root)
  }

  const topLevel = getTopLevelIndexEvents(indexEvents)
  const addressToRoot = buildAddressToRootMap(topLevel, indexByAddress)

  if (!contentPrimary) {
    try {
      const fromReadingCache = await indexedDb.getCachedEventsForSearch(
      q,
      LIBRARY_SEARCH_READING_CACHE_LIMIT,
      [ExtendedKind.PUBLICATION],
      { scanBudget: 12_000, collectCap: 400 }
    )
    for (const ev of fromReadingCache) {
      if (ev.kind !== ExtendedKind.PUBLICATION) continue
      if (!publicationIndexMatchesSearchQueryWithAxis(ev, q, axis)) continue
      if (rootMap.has(ev.id)) continue

      const addr = eventTagAddress(ev)
      const indexedRoot = addr ? addressToRoot.get(addr) : undefined
      if (indexedRoot) {
        rootMap.set(indexedRoot.id, indexedRoot)
        continue
      }

      if (filterValidIndexEvents([ev]).length === 0) continue
      const referenced = getReferencedChild30040Addresses(indexEvents)
      if (addr && referenced.has(addr)) continue
      rootMap.set(ev.id, ev)
    }
    } catch (e) {
      if (import.meta.env.DEV) {
        logger.warn('[Library] reading-cache search failed', {
          message: e instanceof Error ? e.message : String(e)
        })
      }
    }
  }

  if (!axis) {
    try {
      const fromContentCache = await indexedDb.getCachedEventsForSearch(
        q,
        LIBRARY_SEARCH_READING_CACHE_LIMIT,
        [ExtendedKind.PUBLICATION_CONTENT],
        contentPrimary
          ? { scanBudget: 60_000, collectCap: 400, phraseOnly: true }
          : { scanBudget: 20_000, collectCap: 400 }
      )
      // A kind-30041 content hit only resolves to a publication via a kind-30040 index whose `a` tags
      // reference it. A book the user has *opened* stores its index in the reading cache, which may not be
      // part of the library index cache — so merge cached indexes into the mapping pool. Without this, a
      // locally-stored excerpt scores a match but maps to no root and silently drops out of the results.
      let mappingIndexEvents = indexEvents
      let mappingIndexByAddress = indexByAddress
      let cachedIndexCount = 0
      if (fromContentCache.length > 0) {
        const cachedIndexes = filterValidIndexEvents(
          await indexedDb.getCachedPublicationEventsByKinds(
            LIBRARY_CONTENT_ROOT_INDEX_SCAN_LIMIT,
            [ExtendedKind.PUBLICATION],
            { scanBudget: 50_000 }
          )
        )
        cachedIndexCount = cachedIndexes.length
        if (cachedIndexes.length > 0) {
          mappingIndexEvents = dedupeEventsById([...indexEvents, ...cachedIndexes])
          mappingIndexByAddress = buildIndexByAddress(mappingIndexEvents)
        }
      }
      let mappedRoots = 0
      for (const { root, match } of findLibraryPublicationContentSearchMatches(
        q,
        fromContentCache,
        mappingIndexEvents,
        mappingIndexByAddress
      )) {
        mappedRoots++
        contentMatchesByRootId.set(root.id, match)
        if (!rootMap.has(root.id)) rootMap.set(root.id, root)
      }

      if (import.meta.env.DEV) {
        diagnoseLocalContentSearch(q, fromContentCache, {
          contentPrimary,
          cachedIndexCount,
          mappedRoots
        })
      }
    } catch (e) {
      if (import.meta.env.DEV) {
        logger.warn('[Library] content-cache search failed', {
          message: e instanceof Error ? e.message : String(e)
        })
      }
    }
  }

  const roots = [...rootMap.values()]
  const entries = report(roots, indexEvents, contentMatchesByRootId)

  const searchContext: LibrarySearchContext = { indexEvents, engagement }
  const prev = getLibrarySearchSessionRow(q, searchContext, { axis })
  // Never persist an empty content-primary result — it would block the next attempt from re-scanning the
  // (now possibly populated) reading cache. Non-empty results and metadata searches cache as before.
  const cacheableEmpty = !!prev?.relaySearched && !contentPrimary
  if (entries.length > 0 || cacheableEmpty) {
    putLibrarySearchSessionRow(
      q,
      searchContext,
      {
        entries,
        mergedIndexEvents: prev?.mergedIndexEvents ?? indexEvents,
        relaySearched: prev?.relaySearched ?? false
      },
      axis
    )
  }

  return entries
}

function tryNpubFromQuery(query: string): string | null {
  const trimmed = query.trim()
  if (!trimmed) return null
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase()
  try {
    const decoded = nip19.decode(trimmed)
    if (decoded.type === 'npub') return decoded.data
    if (decoded.type === 'nprofile') return decoded.data.pubkey
  } catch {
    // not bech32
  }
  return null
}

/** NIP-54-style d-tag slug (matches publication draft normalization). */
function normalizePublicationDTag(term: string): string {
  return term
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Relay search axis for kind-30040 publication indexes. */
export type LibraryPublicationRelaySearchAxis = 'd-tag' | 'title' | 'author'

export const LIBRARY_PUBLICATION_RELAY_SEARCH_AXES: LibraryPublicationRelaySearchAxis[] = [
  'd-tag',
  'title',
  'author'
]

/**
 * Structured (multi-field) library search. Each field is optional; empty/whitespace fields are
 * ignored. `fullText` runs the no-axis content path (kind-30041 body); the rest map to their axis.
 */
export type LibraryStructuredSearchQuery = {
  title?: string
  author?: string
  dTag?: string
  fullText?: string
}

/** A filled field of a structured query, with the relay-search axis it maps to (null = content). */
export type LibraryStructuredSearchField = {
  field: keyof LibraryStructuredSearchQuery
  axis: LibraryPublicationRelaySearchAxis | null
  value: string
}

/** Non-empty fields of a structured query, in a stable order, with their search axis. */
export function structuredQueryFilledFields(
  query: LibraryStructuredSearchQuery
): LibraryStructuredSearchField[] {
  const fields: LibraryStructuredSearchField[] = []
  const title = query.title?.trim()
  if (title) fields.push({ field: 'title', axis: 'title', value: title })
  const author = query.author?.trim()
  if (author) fields.push({ field: 'author', axis: 'author', value: author })
  const dTag = query.dTag?.trim()
  if (dTag) fields.push({ field: 'dTag', axis: 'd-tag', value: dTag })
  const fullText = query.fullText?.trim()
  if (fullText) fields.push({ field: 'fullText', axis: null, value: fullText })
  return fields
}

/** Compact display string for a structured query (used for cache keys, status, and empty-state checks). */
export function structuredQueryToString(query: LibraryStructuredSearchQuery): string {
  return structuredQueryFilledFields(query)
    .map(({ field, value }) => `${field}:${value}`)
    .join(' ')
}

/** d-tag filter values: hyphenated slug variants for relay `#d` REQ. */
export function publicationQueryDTagVariants(query: string): string[] {
  const raw = query.trim()
  if (!raw) return []
  const seen = new Set<string>()
  const add = (value: string) => {
    const v = value.trim().toLowerCase()
    if (v) seen.add(v)
  }
  add(normalizeToDTag(raw))
  add(normalizePublicationDTag(raw))
  add(raw.toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''))
  return [...seen]
}

/** Normalized needles for publication metadata tag match (d / title / author). */
export function publicationQueryNeedles(query: string): string[] {
  const raw = normalizeGeneralSearchQuery(query.trim())
  if (!raw) return []
  const lower = raw.toLowerCase()
  const normalized = lower.replace(/\s+/g, ' ').trim()
  const hyphen = lower
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return [...new Set([lower, normalized, hyphen].filter(Boolean))]
}

/** True when `needle` matches a d-tag slug exactly or as one / more hyphen-delimited segments. */
export function dTagSlugContainsHyphenNeedle(tagValue: string, needle: string): boolean {
  const val = needle.trim().toLowerCase()
  const slug = tagValue.trim().toLowerCase()
  if (!val || !slug) return false
  if (slug === val) return true

  const segments = slug.split('-').filter(Boolean)
  const needleSegments = val.split('-').filter(Boolean)
  if (segments.length === 0 || needleSegments.length === 0) return false

  if (needleSegments.length === 1) {
    return segments.some((seg) => seg === needleSegments[0])
  }

  for (let i = 0; i <= segments.length - needleSegments.length; i++) {
    if (needleSegments.every((seg, j) => segments[i + j] === seg)) return true
  }
  return false
}

function publicationTagValueMatchesNeedles(
  tagValue: string,
  needles: string[],
  exactOnly: boolean
): boolean {
  const val = tagValue.trim().toLowerCase()
  const valSpaced = val.replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
  for (const needle of needles) {
    if (!needle) continue
    const needleSpaced = needle.replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
    if (val === needle || valSpaced === needleSpaced) return true
    if (exactOnly) {
      if (dTagSlugContainsHyphenNeedle(val, needle)) return true
      continue
    }
    if (needle.length < 2) continue
    if (val.includes(needle) || valSpaced.includes(needleSpaced)) return true
  }
  return false
}

export function publicationMetadataTagMatchesQuery(
  event: Event,
  tagName: 'd' | 'title' | 'author',
  query: string
): boolean {
  const needles = publicationQueryNeedles(query)
  if (needles.length === 0) return false
  const exactOnly = tagName === 'd'
  for (const tag of event.tags ?? []) {
    if ((tag[0] || '').toLowerCase() !== tagName) continue
    const value = tag[1]?.trim()
    if (value && publicationTagValueMatchesNeedles(value, needles, exactOnly)) return true
  }
  return false
}

function publicationRelaySearchSourceTerms(query: string): string[] {
  const raw = query.trim()
  if (!raw) return []
  const terms = new Set<string>([raw])
  const adv = parseAdvancedSearch(raw)
  if (adv.title) {
    for (const title of Array.isArray(adv.title) ? adv.title : [adv.title]) {
      const t = title.trim()
      if (t) terms.add(t)
    }
  }
  return [...terms]
}

function publicationRelaySearchTermsForAxis(
  axis: LibraryPublicationRelaySearchAxis,
  query: string
): string[] {
  const raw = query.trim()
  if (!raw) return []

  const adv = parseAdvancedSearch(raw)
  if (axis === 'title' && adv.title) {
    const titles = Array.isArray(adv.title) ? adv.title : [adv.title]
    const trimmed = titles.map((t) => t.trim()).filter(Boolean)
    if (trimmed.length > 0) return [...new Set(trimmed)]
  }
  if (axis === 'author' && adv.author) {
    const authors = Array.isArray(adv.author) ? adv.author : [adv.author]
    const trimmed = authors.map((a) => a.trim()).filter(Boolean)
    if (trimmed.length > 0) return [...new Set(trimmed)]
  }
  if (axis === 'd-tag') {
    return publicationRelaySearchSourceTerms(raw)
  }
  return [raw]
}

/**
 * Needles for gc_index_relay `POST /api/publications/search` (substring + exact metadata match on d/title/author/source).
 * Jumble re-applies {@link publicationMetadataTagMatchesQuery} on axis-filtered results; these terms widen API hits
 * (hyphen variants, advanced-search fields, long tokens).
 */
export function publicationMetadataSearchTermsForHttpRelay(
  axis: LibraryPublicationRelaySearchAxis,
  query: string
): string[] {
  const seen = new Set<string>()
  const add = (value: string) => {
    const t = value.trim()
    if (t) seen.add(t)
  }

  for (const source of publicationRelaySearchTermsForAxis(axis, query)) {
    add(source)
    for (const needle of publicationQueryNeedles(source)) add(needle)
  }

  if (axis === 'title' || axis === 'author') {
    for (const word of generalSearchQueryTerms(query)) {
      if (word.length >= 4) add(word)
    }
  }

  return [...seen].slice(0, LIBRARY_HTTP_METADATA_SEARCH_TERM_CAP)
}

function addPublicationKindFilter(
  out: Filter[],
  seen: Set<string>,
  filter: Filter
) {
  const key = JSON.stringify(filter)
  if (seen.has(key)) return
  seen.add(key)
  out.push(filter)
}

/** NIP-01 `#d` / `#title` / `#author` / `authors` filters for document relays (no NIP-50). */
export function buildDocumentRelayPublicationFilters(
  axis: LibraryPublicationRelaySearchAxis,
  query: string
): Filter[] {
  const searchRaw = query.trim()
  if (!searchRaw) return []

  const limit = Math.max(1, Math.min(LIBRARY_RELAY_SEARCH_LIMIT, 100))
  const kind = ExtendedKind.PUBLICATION
  const filters: Filter[] = []
  const seen = new Set<string>()
  const add = (filter: Filter) => {
    const key = JSON.stringify(filter)
    if (seen.has(key)) return
    seen.add(key)
    filters.push(filter)
  }

  if (axis === 'author') {
    const npub = tryNpubFromQuery(searchRaw)
    if (npub) return [{ kinds: [kind], authors: [npub], limit }]
    const authors = publicationMetadataSearchTermsForHttpRelay('author', searchRaw)
    if (authors.length > 0) {
      add({ kinds: [kind], '#author': authors, limit })
    }
    return filters
  }

  if (axis === 'title') {
    const titles = publicationMetadataSearchTermsForHttpRelay('title', searchRaw)
    if (titles.length > 0) {
      add({ kinds: [kind], '#title': titles, limit })
    }
    const dTags = new Set<string>()
    for (const term of [...publicationRelaySearchTermsForAxis('title', searchRaw), searchRaw]) {
      for (const d of publicationQueryDTagVariants(term)) dTags.add(d)
    }
    if (dTags.size > 0) {
      add({ kinds: [kind], '#d': [...dTags], limit })
    }
    return filters
  }

  const dTags = new Set<string>()
  for (const term of publicationRelaySearchTermsForAxis('d-tag', searchRaw)) {
    for (const d of publicationQueryDTagVariants(term)) dTags.add(d)
  }
  if (dTags.size > 0) {
    add({ kinds: [kind], '#d': [...dTags], limit })
  }
  return filters
}

function documentRelayUrlsForSearch(blockedRelays: readonly string[] = []): string[] {
  return stripLocalNetworkRelaysForWssReq(
    filterBlockedLibraryRelays(
      DOCUMENT_RELAY_URLS.map(normalizeLibraryRelayUrl).filter(Boolean),
      blockedRelays
    )
  )
}

/**
 * Query {@link DOCUMENT_RELAY_URLS} for kind-30040 indexes by `#d`, `#title`, `#author`, or `authors`.
 * Document relays do not support NIP-50; when tag filters miss, paginates kind 30040 and matches client-side.
 */
export async function fetchPublicationIndexesFromDocumentRelays(
  axis: LibraryPublicationRelaySearchAxis,
  query: string,
  blockedRelays: readonly string[] = [],
  options?: { onPartialEvents?: (events: Event[]) => void }
): Promise<Event[]> {
  const filters = buildDocumentRelayPublicationFilters(axis, query)
  const relays = documentRelayUrlsForSearch(blockedRelays)
  if (relays.length === 0) return []

  const matched: Event[] = []
  const seen = new Set<string>()
  const addMatches = (batch: Event[]) => {
    const fresh: Event[] = []
    for (const ev of batch) {
      if (seen.has(ev.id)) continue
      seen.add(ev.id)
      matched.push(ev)
      fresh.push(ev)
    }
    if (fresh.length > 0) options?.onPartialEvents?.(fresh)
  }

  if (filters.length > 0) {
    await Promise.all(
      relays.map((relay) =>
        queryService
          .fetchEvents([relay], filters, LIBRARY_DOCUMENT_RELAY_SEARCH_OPTS)
          .then((events) =>
            filterEventsForPublicationRelaySearchAxis(events, axis, query)
          )
          .then((events) => {
            addMatches(events)
            return events
          })
          .catch((e) => {
            if (import.meta.env.DEV) {
              logger.warn('[Library] document relay publication search failed', {
                relay,
                axis,
                message: e instanceof Error ? e.message : String(e)
              })
            }
            return [] as Event[]
          })
      )
    )
  }

  if (matched.length > 0) return matched.slice(0, LIBRARY_RELAY_SEARCH_LIMIT)

  return scanDocumentRelaysForPublicationAxis(axis, query, blockedRelays, {
    onPartialEvents: options?.onPartialEvents
  })
}

async function scanWsRelayForPublicationAxis(
  relay: string,
  axis: LibraryPublicationRelaySearchAxis,
  query: string,
  options?: { maxPages?: number; onPartialEvents?: (events: Event[]) => void }
): Promise<Event[]> {
  const pageLimit = Math.min(100, INDEX_HTTP_PAGE_LIMIT)
  const filter: Filter = { kinds: [ExtendedKind.PUBLICATION], limit: pageLimit }
  const matched: Event[] = []
  const seen = new Set<string>()
  const maxPages = Math.max(1, options?.maxPages ?? LIBRARY_DOCUMENT_RELAY_SCAN_MAX_PAGES)

  const collect = (batch: Event[]) => {
    const fresh: Event[] = []
    for (const ev of filterEventsForPublicationRelaySearchAxis(batch, axis, query)) {
      if (seen.has(ev.id)) continue
      seen.add(ev.id)
      matched.push(ev)
      fresh.push(ev)
      if (matched.length >= LIBRARY_RELAY_SEARCH_LIMIT) break
    }
    if (fresh.length > 0) options?.onPartialEvents?.(fresh)
  }

  let firstPage: Event[] = []
  try {
    firstPage = await queryService.fetchEvents([relay], [filter], LIBRARY_DOCUMENT_RELAY_SEARCH_OPTS)
  } catch (e) {
    if (import.meta.env.DEV) {
      logger.warn('[Library] document relay publication scan first page failed', {
        relay,
        axis,
        message: e instanceof Error ? e.message : String(e)
      })
    }
    return []
  }

  collect(firstPage)
  if (matched.length >= LIBRARY_RELAY_SEARCH_LIMIT || firstPage.length === 0) {
    return matched.slice(0, LIBRARY_RELAY_SEARCH_LIMIT)
  }

  let until = oldestCreatedAt(firstPage) - 1
  for (let page = 1; page < maxPages; page++) {
    if (until < 0) break
    let batch: Event[] = []
    try {
      batch = await queryService.fetchEvents(
        [relay],
        [{ ...filter, until }],
        LIBRARY_DOCUMENT_RELAY_SEARCH_OPTS
      )
    } catch (e) {
      if (import.meta.env.DEV) {
        logger.warn('[Library] document relay publication scan page failed', {
          relay,
          axis,
          page,
          message: e instanceof Error ? e.message : String(e)
        })
      }
      break
    }
    if (batch.length === 0) break
    collect(batch)
    if (matched.length >= LIBRARY_RELAY_SEARCH_LIMIT) break
    if (batch.length < pageLimit) break
    const oldest = oldestCreatedAt(batch)
    if (oldest === Number.MAX_SAFE_INTEGER) break
    until = oldest - 1
  }

  return matched.slice(0, LIBRARY_RELAY_SEARCH_LIMIT)
}

async function scanDocumentRelaysForPublicationAxis(
  axis: LibraryPublicationRelaySearchAxis,
  query: string,
  blockedRelays: readonly string[] = [],
  options?: { onPartialEvents?: (events: Event[]) => void }
): Promise<Event[]> {
  const relays = documentRelayUrlsForSearch(blockedRelays)
  if (relays.length === 0) return []

  const settled = await Promise.all(
    relays.map((relay) =>
      scanWsRelayForPublicationAxis(relay, axis, query, {
        onPartialEvents: options?.onPartialEvents
      })
    )
  )
  return dedupeEventsById(settled.flat()).slice(0, LIBRARY_RELAY_SEARCH_LIMIT)
}

/** All-fields library search: quote-like text should query kind-30041 body on relays. */
export function shouldSearchPublicationContentOnRelays(
  query: string,
  axis?: LibraryPublicationRelaySearchAxis | null
): boolean {
  if (axis) return false
  const trimmed = query.trim()
  if (!trimmed) return false
  if (isQuotedSearchQuery(trimmed)) return true
  const norm = normalizeGeneralSearchQuery(trimmed)
  if (norm.length >= 24) return true
  if (/[.;!?,:]/.test(norm)) return true
  return generalSearchQueryTerms(trimmed).length >= 5
}

export function filterPublicationContentEventsForQuery(events: Event[], query: string): Event[] {
  return rankPublicationContentEventsForQuery(events, query)
}

/** Score kind-30041 rows for {@code query} and return the best matches first. */
export function rankPublicationContentEventsForQuery(
  events: Event[],
  query: string,
  limit = LIBRARY_RELAY_SEARCH_LIMIT
): Event[] {
  const q = query.trim()
  if (!q) return []
  return events
    .filter((ev) => ev.kind === ExtendedKind.PUBLICATION_CONTENT)
    .map((ev) => ({ ev, score: scorePublicationContentEventSearchQuery(ev, q) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ ev }) => ev)
}

const LIBRARY_CONTENT_RELAY_HTTP_RESULT_LIMIT = 25
const LIBRARY_CONTENT_ROOT_LOOKUP_LIMIT = 20

function persistPublicationContentEventsForReading(events: Event[]): void {
  for (const ev of events) {
    client.addEventToCache(ev)
    void indexedDb.putReplaceableEvent(ev).catch(() => {})
  }
}

async function scanWsRelayForPublicationContent(
  relay: string,
  query: string,
  options?: { maxPages?: number; onPartialEvents?: (events: Event[]) => void }
): Promise<Event[]> {
  const pageLimit = LIBRARY_CONTENT_RELAY_PAGE_LIMIT
  const filter: Filter = { kinds: [ExtendedKind.PUBLICATION_CONTENT], limit: pageLimit }
  const matched: Event[] = []
  const seen = new Set<string>()
  const maxPages = Math.max(1, options?.maxPages ?? LIBRARY_CONTENT_RELAY_SCAN_MAX_PAGES)

  const collect = (batch: Event[]) => {
    const fresh: Event[] = []
    for (const ev of filterPublicationContentEventsForQuery(batch, query)) {
      if (seen.has(ev.id)) continue
      seen.add(ev.id)
      matched.push(ev)
      fresh.push(ev)
      if (matched.length >= LIBRARY_RELAY_SEARCH_LIMIT) break
    }
    if (fresh.length > 0) options?.onPartialEvents?.(fresh)
  }

  let firstPage: Event[] = []
  try {
    firstPage = await queryService.fetchEvents([relay], [filter], LIBRARY_CONTENT_RELAY_SEARCH_OPTS)
  } catch (e) {
    if (import.meta.env.DEV) {
      logger.warn('[Library] publication content relay scan first page failed', {
        relay,
        message: e instanceof Error ? e.message : String(e)
      })
    }
    return []
  }

  collect(firstPage)
  if (matched.length >= LIBRARY_RELAY_SEARCH_LIMIT || firstPage.length === 0) {
    return matched.slice(0, LIBRARY_RELAY_SEARCH_LIMIT)
  }

  let until = oldestCreatedAt(firstPage) - 1
  for (let page = 1; page < maxPages; page++) {
    if (until < 0) break
    let batch: Event[] = []
    try {
      batch = await queryService.fetchEvents(
        [relay],
        [{ ...filter, until }],
        LIBRARY_CONTENT_RELAY_SEARCH_OPTS
      )
    } catch (e) {
      if (import.meta.env.DEV) {
        logger.warn('[Library] publication content relay scan page failed', {
          relay,
          page,
          message: e instanceof Error ? e.message : String(e)
        })
      }
      break
    }
    if (batch.length === 0) break
    collect(batch)
    if (matched.length >= LIBRARY_RELAY_SEARCH_LIMIT) break
    if (batch.length < pageLimit) break
    const oldest = oldestCreatedAt(batch)
    if (oldest === Number.MAX_SAFE_INTEGER) break
    until = oldest - 1
  }

  return matched.slice(0, LIBRARY_RELAY_SEARCH_LIMIT)
}

/**
 * Document relays that advertise NIP-50 (`supported_nips` includes 50): query kind-30041 body with a
 * server-side `search` filter for true full-text matching. Relays without NIP-50 are skipped here and
 * left to the paginated scan fallback.
 */
async function searchWsRelaysForPublicationContentNip50(
  query: string,
  wsRelays: string[],
  options?: { onPartialEvents?: (events: Event[]) => void }
): Promise<Event[]> {
  const q = query.trim()
  if (!q || wsRelays.length === 0) return []

  let nip50Relays: string[] = []
  try {
    const infos = await relayInfoService.getRelayInfos(wsRelays)
    nip50Relays = wsRelays.filter((_, i) => infos[i]?.supported_nips?.includes(50))
  } catch {
    nip50Relays = []
  }
  if (nip50Relays.length === 0) return []

  const filter: Filter = {
    kinds: [ExtendedKind.PUBLICATION_CONTENT],
    search: q,
    limit: LIBRARY_CONTENT_RELAY_HTTP_RESULT_LIMIT
  }
  const collected: Event[] = []
  await Promise.all(
    nip50Relays.map((relay) =>
      queryService
        .fetchEvents([relay], [filter], LIBRARY_CONTENT_RELAY_SEARCH_OPTS)
        .then((events) => {
          if (events.length === 0) return
          collected.push(...events)
          options?.onPartialEvents?.(events)
        })
        .catch((e) => {
          if (import.meta.env.DEV) {
            logger.warn('[Library] WS NIP-50 publication content search failed', {
              relay,
              message: e instanceof Error ? e.message : String(e)
            })
          }
        })
    )
  )
  return collected
}

type PublicationSectionRootRef = { sectionAddress: string; authorPubkey: string }

const MAX_PUBLICATION_ROOT_LOOKUP_PASSES = 4
const PUBLICATION_ROOT_LOOKUP_CONCURRENCY = 6
const CONTENT_ROOT_RESOLVE_DEBOUNCE_MS = 300

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === 'AbortError'
    : err instanceof Error && err.name === 'AbortError'
}

function collectOrphanPublicationSectionRootRefs(
  contentEvents: Iterable<Event>,
  indexEvents: Event[],
  indexByAddress: Map<string, Event>,
  options?: { query?: string; maxRefs?: number }
): PublicationSectionRootRef[] {
  const ranked =
    options?.query?.trim() ?
      rankPublicationContentEventsForQuery(
        [...contentEvents],
        options.query,
        options.maxRefs ?? LIBRARY_CONTENT_ROOT_LOOKUP_LIMIT
      )
    : [...contentEvents]

  const rootRefs: PublicationSectionRootRef[] = []
  const seenSectionAddrs = new Set<string>()

  for (const ev of ranked) {
    if (ev.kind !== ExtendedKind.PUBLICATION_CONTENT) continue
    const addr = eventTagAddress(ev)
    if (!addr || seenSectionAddrs.has(addr)) continue
    seenSectionAddrs.add(addr)
    if (findPublicationRootForContentAddress(addr, indexEvents, indexByAddress)) continue
    rootRefs.push({ sectionAddress: addr, authorPubkey: ev.pubkey.toLowerCase() })
  }

  return rootRefs
}

/** Fetch kind-30040 indexes that reference section coordinates (Mercury `#a` filter). */
async function fetchPublicationIndexRootsForContentSections(
  httpRelays: string[],
  refs: PublicationSectionRootRef[],
  options?: { signal?: AbortSignal }
): Promise<Event[]> {
  if (httpRelays.length === 0 || refs.length === 0) return []

  const uniqueRefs = new Map<string, PublicationSectionRootRef>()
  for (const ref of refs) {
    uniqueRefs.set(ref.sectionAddress, ref)
  }

  const seenIds = new Set<string>()
  const out: Event[] = []
  const jobs: Array<{ relay: string; sectionAddress: string; authorPubkey: string }> = []
  for (const relay of httpRelays) {
    for (const { sectionAddress, authorPubkey } of uniqueRefs.values()) {
      jobs.push({ relay, sectionAddress, authorPubkey })
    }
  }

  for (const chunk of chunkArray(jobs, PUBLICATION_ROOT_LOOKUP_CONCURRENCY)) {
    if (options?.signal?.aborted) break
    await Promise.all(
      chunk.map(async ({ relay, sectionAddress, authorPubkey }) => {
        if (options?.signal?.aborted) return
        try {
          const page = await queryIndexRelayForLibrary(
            relay,
            {
              kinds: [ExtendedKind.PUBLICATION],
              authors: [authorPubkey],
              '#a': [sectionAddress],
              limit: 10
            },
            { signal: options?.signal }
          )
          for (const ev of page.events as Event[]) {
            if (seenIds.has(ev.id)) continue
            seenIds.add(ev.id)
            out.push(ev)
          }
        } catch (e) {
          if (isAbortError(e)) return
          if (import.meta.env.DEV) {
            logger.warn('[Library] HTTP publication root lookup failed', {
              relay,
              sectionAddress,
              message: e instanceof Error ? e.message : String(e)
            })
          }
        }
      })
    )
  }

  return filterValidIndexEvents(out)
}

/** Resolve kind-30040 indexes for section hits that are not yet linked to a publication root. */
async function resolvePublicationIndexRootsForOrphanContentSections(
  contentEvents: Iterable<Event>,
  structuralMap: PublicationIndexMap,
  httpRelays: string[],
  options?: { signal?: AbortSignal; query?: string }
): Promise<{ structuralMap: PublicationIndexMap; fetched: Event[] }> {
  if (httpRelays.length === 0) {
    return { structuralMap, fetched: [] }
  }

  let map = structuralMap
  const fetched: Event[] = []
  const seenIds = new Set<string>()

  for (let pass = 0; pass < MAX_PUBLICATION_ROOT_LOOKUP_PASSES; pass++) {
    const mergedIndex = publicationIndexMapValues(map)
    const indexByAddress = buildIndexByAddress(mergedIndex)
    const rootRefs = collectOrphanPublicationSectionRootRefs(
      contentEvents,
      mergedIndex,
      indexByAddress,
      { query: options?.query, maxRefs: LIBRARY_CONTENT_ROOT_LOOKUP_LIMIT }
    )
    if (rootRefs.length === 0) break

    const batch = await fetchPublicationIndexRootsForContentSections(httpRelays, rootRefs, {
      signal: options?.signal
    })
    const valid = filterValidIndexEvents(batch).filter((ev) => !seenIds.has(ev.id))
    if (valid.length === 0) break

    for (const ev of valid) seenIds.add(ev.id)
    fetched.push(...valid)
    map = mergePublicationIndexMaps(map, valid)
  }

  return { structuralMap: map, fetched }
}

/** Scan Mercury HTTP index relays and WS document relays for kind-30041 section body text matching {@code query}. */
export async function fetchPublicationContentFromRelays(
  query: string,
  relayUrls: string[],
  blockedRelays: readonly string[] = [],
  options?: { onPartialEvents?: (events: Event[]) => void }
): Promise<Event[]> {
  const q = query.trim()
  if (!q) return []

  // Long passages make relay token-AND search return nothing or bury the right section, so send the relay
  // a bounded, distinctive window. Ranking/highlighting still use the full query `q`.
  const relayQuery = buildRelayContentSearchQuery(q)
  if (import.meta.env.DEV && relayQuery !== q) {
    logger.info('[Library] relay content query capped', {
      original: q,
      originalWords: q.split(/\s+/).filter(Boolean).length,
      relayQuery,
      relayWords: relayQuery.split(/\s+/).filter(Boolean).length
    })
  }

  const relayCandidates = filterBlockedLibraryRelays(
    [
      ...new Set([
        ...relayUrls.map(normalizeLibraryRelayUrl).filter(Boolean),
        ...LIBRARY_RELAY_URLS.map(normalizeLibraryRelayUrl).filter(Boolean),
        ...documentRelayUrlsForSearch(blockedRelays)
      ])
    ] as string[],
    blockedRelays
  )
  const { wsRelays, httpRelays } = splitWsAndHttpRelays(relayCandidates)
  const wsDocumentRelays = stripLocalNetworkRelaysForWssReq(
    wsRelays.filter((relay) => relay.startsWith('wss://') || relay.startsWith('ws://'))
  )
  if (httpRelays.length === 0 && wsDocumentRelays.length === 0) return []

  const globalSeen = new Set<string>()
  const globalMatched: Event[] = []

  const emitMatches = (events: Event[]) => {
    const ranked = rankPublicationContentEventsForQuery(events, q, LIBRARY_CONTENT_RELAY_HTTP_RESULT_LIMIT)
    const fresh: Event[] = []
    for (const ev of ranked) {
      if (globalSeen.has(ev.id)) continue
      globalSeen.add(ev.id)
      globalMatched.push(ev)
      fresh.push(ev)
      if (globalMatched.length >= LIBRARY_CONTENT_RELAY_HTTP_RESULT_LIMIT) break
    }
    if (fresh.length > 0) {
      persistPublicationContentEventsForReading(fresh)
      options?.onPartialEvents?.(fresh)
    }
  }

  // Mercury HTTP full-text search and WS NIP-50 search run in parallel; both stream into emitMatches.
  const primaryTasks: Promise<unknown>[] = []
  if (httpRelays.length > 0) {
    primaryTasks.push(
      Promise.all(
        httpRelays.map((relay) =>
          queryIndexRelayPublicationContentSearch(relay, relayQuery, {
            limit: LIBRARY_CONTENT_RELAY_HTTP_RESULT_LIMIT
          })
            .then((page) => {
              emitMatches(page.events as Event[])
            })
            .catch((e) => {
              if (import.meta.env.DEV) {
                logger.warn('[Library] HTTP publication content search failed', {
                  relay,
                  message: e instanceof Error ? e.message : String(e)
                })
              }
            })
        )
      )
    )
  }
  if (wsDocumentRelays.length > 0) {
    primaryTasks.push(
      searchWsRelaysForPublicationContentNip50(relayQuery, wsDocumentRelays, {
        onPartialEvents: emitMatches
      }).catch(() => [] as Event[])
    )
  }
  await Promise.all(primaryTasks)

  // Fallback for relays without server-side full-text: paginate kind-30041 and match client-side.
  // WS pagination only adds noisy word matches for long quotes, so it runs only when nothing matched.
  if (globalMatched.length === 0 && wsDocumentRelays.length > 0) {
    await Promise.all(
      wsDocumentRelays.map((relay) =>
        scanWsRelayForPublicationContent(relay, q, {
          onPartialEvents: (batch) => emitMatches(batch)
        }).catch(() => [] as Event[])
      )
    )
  }

  return globalMatched.slice(0, LIBRARY_CONTENT_RELAY_HTTP_RESULT_LIMIT)
}

/** One axis of kind-30040 relay discovery: `#d`, metadata title/author (HTTP), or `authors` for npub. */
export function buildLibraryPublicationRelaySearchFiltersForAxis(
  axis: LibraryPublicationRelaySearchAxis,
  opts: { query: string; limit?: number }
): Filter[] {
  const searchRaw = opts.query.trim()
  if (!searchRaw) return []

  const limit = Math.max(1, Math.min(opts.limit ?? LIBRARY_RELAY_SEARCH_LIMIT, 100))
  const kind = ExtendedKind.PUBLICATION
  const seen = new Set<string>()
  const out: Filter[] = []

  if (axis === 'author') {
    const npub = tryNpubFromQuery(searchRaw)
    if (npub) {
      addPublicationKindFilter(out, seen, { kinds: [kind], authors: [npub], limit })
      return out
    }
    return out
  }

  if (axis === 'title') {
    return out
  }

  if (axis === 'd-tag') {
    const dTags = new Set<string>()
    for (const term of publicationRelaySearchTermsForAxis('d-tag', searchRaw)) {
      for (const d of publicationQueryDTagVariants(term)) dTags.add(d)
    }
    if (dTags.size === 0) return []
    addPublicationKindFilter(out, seen, { kinds: [kind], '#d': [...dTags], limit })
    return out
  }

  return out
}

/**
 * REQ filters for kind **30040** publication indexes, split by axis (d-tag, title, author).
 * Title and author text use HTTP metadata search (not NIP-50). Only `#d` and pubkey `authors` use NIP-01 filters.
 */
export function buildLibraryPublicationRelaySearchFilters(opts: {
  query: string
  limit?: number
}): Filter[] {
  const seen = new Set<string>()
  const out: Filter[] = []
  for (const axis of LIBRARY_PUBLICATION_RELAY_SEARCH_AXES) {
    for (const filter of buildLibraryPublicationRelaySearchFiltersForAxis(axis, opts)) {
      const key = JSON.stringify(filter)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(filter)
    }
  }
  return out
}

export function filterEventsForPublicationRelaySearchAxis(
  events: Event[],
  axis: LibraryPublicationRelaySearchAxis,
  query: string
): Event[] {
  const terms = publicationRelaySearchTermsForAxis(axis, query)
  if (terms.length === 0) return []

  return events.filter((event) => {
    if (event.kind !== ExtendedKind.PUBLICATION) return false
    if (axis === 'author') {
      const npub = tryNpubFromQuery(query.trim())
      if (npub && event.pubkey.toLowerCase() === npub) return true
    }
    const tagName = axis === 'd-tag' ? 'd' : axis
    return terms.some((term) => publicationMetadataTagMatchesQuery(event, tagName, term))
  })
}

export function publicationIndexMatchesSearchQueryWithAxis(
  event: Event,
  query: string,
  axis?: LibraryPublicationRelaySearchAxis | null
): boolean {
  if (!axis) return publicationIndexMatchesSearchQuery(event, query)
  return filterEventsForPublicationRelaySearchAxis([event], axis, query).length > 0
}

async function scanHttpIndexRelayForPublicationAxis(
  httpRelay: string,
  axis: LibraryPublicationRelaySearchAxis,
  term: string,
  options?: { maxPages?: number; onPartialEvents?: (events: Event[]) => void }
): Promise<Event[]> {
  const filter: Filter = { kinds: [ExtendedKind.PUBLICATION], limit: INDEX_HTTP_PAGE_LIMIT }
  const matched: Event[] = []
  const seen = new Set<string>()
  const maxPages = Math.max(1, options?.maxPages ?? LIBRARY_RELAY_SEARCH_SCAN_MAX_PAGES)

  const collect = (batch: Event[]) => {
    const fresh: Event[] = []
    for (const ev of filterEventsForPublicationRelaySearchAxis(batch, axis, term)) {
      if (seen.has(ev.id)) continue
      seen.add(ev.id)
      matched.push(ev)
      fresh.push(ev)
      if (matched.length >= LIBRARY_RELAY_SEARCH_LIMIT) break
    }
    if (fresh.length > 0) options?.onPartialEvents?.(fresh)
  }

  let firstPage: Event[]
  try {
    firstPage = (await queryIndexRelayForLibrary(httpRelay, filter)).events as Event[]
  } catch (e) {
    if (import.meta.env.DEV) {
      logger.warn('[Library] HTTP publication scan first page failed', {
        relay: httpRelay,
        axis,
        message: e instanceof Error ? e.message : String(e)
      })
    }
    return []
  }

  collect(firstPage)
  if (matched.length >= LIBRARY_RELAY_SEARCH_LIMIT || firstPage.length === 0) {
    return matched.slice(0, LIBRARY_RELAY_SEARCH_LIMIT)
  }

  let until = oldestCreatedAt(firstPage) - 1
  for (let page = 1; page < maxPages; page++) {
    if (until < 0) break
    let batch: Event[] = []
    let apiRowCount = 0
    try {
      const pageResult = await queryIndexRelayForLibrary(httpRelay, { ...filter, until })
      batch = pageResult.events as Event[]
      apiRowCount = pageResult.apiRowCount
    } catch (e) {
      if (import.meta.env.DEV) {
        logger.warn('[Library] HTTP publication scan page failed', {
          relay: httpRelay,
          axis,
          page,
          message: e instanceof Error ? e.message : String(e)
        })
      }
      break
    }
    if (apiRowCount === 0) break
    collect(batch)
    if (matched.length >= LIBRARY_RELAY_SEARCH_LIMIT) break
    if (apiRowCount < INDEX_HTTP_PAGE_LIMIT) break
    const oldest = oldestCreatedAt(batch)
    if (oldest === Number.MAX_SAFE_INTEGER) break
    until = oldest - 1
  }

  return matched.slice(0, LIBRARY_RELAY_SEARCH_LIMIT)
}

async function searchHttpIndexRelayPublicationAxis(
  httpRelay: string,
  axis: LibraryPublicationRelaySearchAxis,
  query: string,
  options?: {
    allowFullScan?: boolean
    fullScanMaxPages?: number
    onPartialEvents?: (events: Event[]) => void
  }
): Promise<Event[]> {
  const terms = publicationMetadataSearchTermsForHttpRelay(axis, query)
  const matched: Event[] = []
  const seen = new Set<string>()

  const addFiltered = (events: Event[]) => {
    const fresh: Event[] = []
    for (const ev of filterEventsForPublicationRelaySearchAxis(events, axis, query)) {
      if (seen.has(ev.id)) continue
      seen.add(ev.id)
      matched.push(ev)
      fresh.push(ev)
      if (matched.length >= LIBRARY_RELAY_SEARCH_LIMIT) break
    }
    if (fresh.length > 0) options?.onPartialEvents?.(fresh)
  }

  await Promise.all(
    terms.map((term) =>
      queryIndexRelayPublicationMetadataSearch(httpRelay, term, {
        limit: LIBRARY_RELAY_SEARCH_LIMIT
      })
        .then((page) => {
          addFiltered(page.events as Event[])
        })
        .catch(() => undefined)
    )
  )
  if (matched.length >= LIBRARY_RELAY_SEARCH_LIMIT) {
    return matched.slice(0, LIBRARY_RELAY_SEARCH_LIMIT)
  }
  if (matched.length > 0) return matched

  if (options?.allowFullScan === false) return []

  return scanHttpIndexRelayForPublicationAxis(httpRelay, axis, query, {
    maxPages: options?.fullScanMaxPages,
    onPartialEvents: options?.onPartialEvents
  })
}

/** Fast path: document relays only, merge into index, return library entries. */
export async function searchLibraryPublicationsViaDocumentRelays(
  query: string,
  context: LibrarySearchContext,
  axis: LibraryPublicationRelaySearchAxis,
  blockedRelays: readonly string[] = [],
  options?: { onProgress?: (progress: LibrarySearchProgress) => void }
): Promise<{
  events: Event[]
  entries: LibraryPublicationEntry[]
  mergedIndexEvents: Event[]
}> {
  const q = query.trim()
  if (!q) {
    return { events: [], entries: [], mergedIndexEvents: context.indexEvents ?? [] }
  }

  let structuralMap = buildStructuralPublicationIndexMap(context.indexEvents ?? [])
  const accumulated = new Map<string, Event>()
  const engagement = context.engagement ?? EMPTY_ENGAGEMENT

  const emitProgress = () => {
    const mergedIndex = publicationIndexMapValues(structuralMap)
    const indexByAddress = buildIndexByAddress(mergedIndex)
    const roots = searchLibraryPublicationIndex(q, mergedIndex, indexByAddress, axis)
    const entries = sortLibraryPublications(
      libraryEntriesFromRoots(roots, indexByAddress, engagement)
    )
    options?.onProgress?.({ entries, mergedIndexEvents: mergedIndex })
    return { mergedIndex, entries }
  }

  const networkEvents = await fetchPublicationIndexesFromDocumentRelays(axis, q, blockedRelays, {
    onPartialEvents: (batch) => {
      const valid = filterValidIndexEvents(batch)
      if (valid.length === 0) return
      for (const ev of valid) accumulated.set(ev.id, ev)
      structuralMap = mergePublicationIndexMaps(structuralMap, valid)
      emitProgress()
    }
  })
  const valid = filterValidIndexEvents(networkEvents)
  if (valid.length === 0) {
    return { events: [], entries: [], mergedIndexEvents: context.indexEvents ?? [] }
  }

  for (const ev of valid) accumulated.set(ev.id, ev)
  structuralMap = mergePublicationIndexMaps(
    buildStructuralPublicationIndexMap(context.indexEvents ?? []),
    valid
  )
  await persistRelayDiscoveredLibraryIndexes(valid)
  const { mergedIndex, entries } = emitProgress()

  putLibrarySearchSessionRow(
    q,
    { indexEvents: mergedIndex, engagement },
    { entries, mergedIndexEvents: mergedIndex, relaySearched: true },
    axis
  )

  if (import.meta.env.DEV) {
    logger.info('[Library] document relay search done', {
      query: q,
      axis,
      network: valid.length,
      entries: entries.length
    })
  }

  return { events: valid, entries, mergedIndexEvents: mergedIndex }
}

/** Query document relays for kind-30040 indexes matching {@link buildLibraryPublicationRelaySearchFilters}. */
export async function searchLibraryPublicationsOnRelays(
  query: string,
  relayUrls: string[],
  context: LibrarySearchContext,
  options?: {
    forceRefresh?: boolean
    axis?: LibraryPublicationRelaySearchAxis | null
    blockedRelays?: readonly string[]
    onProgress?: (progress: LibrarySearchProgress) => void
  }
): Promise<{
  events: Event[]
  entries: LibraryPublicationEntry[]
  mergedIndexEvents: Event[]
  fromCache: boolean
}> {
  const q = query.trim()
  if (!q) {
    return { events: [], entries: [], mergedIndexEvents: context.indexEvents ?? [], fromCache: false }
  }

  const contentPrimary = isContentPrimarySearch(q, options?.axis)
  if (!options?.forceRefresh) {
    const cached = getLibrarySearchSessionRow(q, context, {
      requireRelaySearch: true,
      axis: options?.axis
    })
    // A stale empty content-primary row must not short-circuit the relay pass (best-effort full-text +
    // dynamically-cached content mean a later attempt can still succeed).
    if (cached && !(contentPrimary && cached.entries.length === 0)) {
      if (import.meta.env.DEV) {
        logger.info('[Library] relay search cache hit', { query: q })
      }
      options?.onProgress?.({
        entries: cached.entries,
        mergedIndexEvents: cached.mergedIndexEvents
      })
      return {
        events: [],
        entries: cached.entries,
        mergedIndexEvents: cached.mergedIndexEvents,
        fromCache: true
      }
    }
  }

  const blockedRelays = options?.blockedRelays ?? []
  const indexRelays = libraryIndexRelayUrls(relayUrls)
  const { wsRelays, httpRelays } = splitWsAndHttpRelays(indexRelays)
  const engagement = context.engagement ?? EMPTY_ENGAGEMENT
  let structuralMap = buildStructuralPublicationIndexMap(context.indexEvents ?? [])
  const accumulatedValid = new Map<string, Event>()
  const accumulatedContent = new Map<string, Event>()
  const contentMatchesByRootId = new Map<string, LibraryPublicationContentSearchMatch>()
  const preferContentRelaySearch = shouldSearchPublicationContentOnRelays(q, options?.axis)

  // For content/passage searches, resolve relay content hits against indexes the user already has cached
  // from reading too — a hit's parent kind-30040 may live only in the reading cache, not in the library
  // index or the relay response. Kept separate from the reported merged index so the library isn't polluted.
  let contentRootResolverIndexes: Event[] = []
  if (preferContentRelaySearch && !options?.axis) {
    try {
      contentRootResolverIndexes = filterValidIndexEvents(
        await indexedDb.getCachedPublicationEventsByKinds(
          LIBRARY_CONTENT_ROOT_INDEX_SCAN_LIMIT,
          [ExtendedKind.PUBLICATION],
          { scanBudget: 50_000 }
        )
      )
    } catch (e) {
      if (import.meta.env.DEV) {
        logger.warn('[Library] relay content root index preload failed', {
          message: e instanceof Error ? e.message : String(e)
        })
      }
    }
  }

  const buildProgress = (): LibrarySearchProgress => {
    const mergedIndex = publicationIndexMapValues(structuralMap)
    const indexByAddress = buildIndexByAddress(mergedIndex)
    // Augmented pool (relay/library index + cached reading indexes) used only to resolve content hits to a
    // root and to render entries — never reported back as the library index.
    const resolverIndex = contentRootResolverIndexes.length
      ? dedupeEventsById([...mergedIndex, ...contentRootResolverIndexes])
      : mergedIndex
    const resolverByAddress =
      resolverIndex === mergedIndex ? indexByAddress : buildIndexByAddress(resolverIndex)
    const rootMap = new Map<string, Event>()
    if (!preferContentRelaySearch || options?.axis) {
      for (const root of searchLibraryPublicationIndex(q, mergedIndex, indexByAddress, options?.axis)) {
        rootMap.set(root.id, root)
      }
    }
    if (!options?.axis && accumulatedContent.size > 0) {
      for (const { root, match } of findLibraryPublicationContentSearchMatches(
        q,
        [...accumulatedContent.values()],
        resolverIndex,
        resolverByAddress
      )) {
        contentMatchesByRootId.set(root.id, match)
        rootMap.set(root.id, root)
      }
    }
    const sortedEntries = sortLibrarySearchPublications(
      libraryEntriesFromRoots([...rootMap.values()], resolverByAddress, engagement, contentMatchesByRootId)
    )
    const phraseEntries = sortedEntries.filter(
      (entry) => (entry.contentSearchMatch?.matchScore ?? 0) >= 10_000
    )
    // For a passage/content search, only surface publications whose section actually contains the
    // query phrase. The scattered-word fallback (any ≥2 query words present) matches every long
    // text on common words, so it returned the same handful of unrelated books for every query.
    // No phrase match → no result, which is correct here rather than dumping false positives.
    const entries =
      preferContentRelaySearch && !options?.axis ? phraseEntries : sortedEntries
    return {
      entries,
      mergedIndexEvents: mergedIndex,
      networkEventCount: accumulatedValid.size + accumulatedContent.size
    }
  }

  const reportBatch = (batchEvents: Event[]) => {
    const valid = filterValidIndexEvents(batchEvents)
    if (valid.length === 0) return
    for (const ev of valid) accumulatedValid.set(ev.id, ev)
    structuralMap = mergePublicationIndexMaps(structuralMap, valid)
    options?.onProgress?.(buildProgress())
  }

  let contentProgressGeneration = 0
  let contentRootResolution = Promise.resolve()
  let contentRootResolveTimer: number | null = null
  const contentRootLookupAbortRef: { current: AbortController | null } = { current: null }

  const runContentRootResolve = (generation: number, signal: AbortSignal) => {
    contentRootResolution = contentRootResolution.then(async () => {
      if (generation !== contentProgressGeneration || signal.aborted) return
      const resolved = await resolvePublicationIndexRootsForOrphanContentSections(
        accumulatedContent.values(),
        structuralMap,
        httpRelays,
        { signal, query: q }
      )
      if (generation !== contentProgressGeneration || signal.aborted) return
      if (resolved.fetched.length > 0) {
        for (const ev of resolved.fetched) accumulatedValid.set(ev.id, ev)
        structuralMap = resolved.structuralMap
        await persistRelayDiscoveredLibraryIndexes(resolved.fetched)
      }
      if (generation !== contentProgressGeneration || signal.aborted) return
      options?.onProgress?.(buildProgress())
    })
  }

  const scheduleContentRootResolve = () => {
    if (contentRootResolveTimer !== null) {
      window.clearTimeout(contentRootResolveTimer)
    }
    contentRootResolveTimer = window.setTimeout(() => {
      contentRootResolveTimer = null
      if (contentRootLookupAbortRef.current) contentRootLookupAbortRef.current.abort()
      contentRootLookupAbortRef.current = new AbortController()
      const generation = ++contentProgressGeneration
      runContentRootResolve(generation, contentRootLookupAbortRef.current.signal)
    }, CONTENT_ROOT_RESOLVE_DEBOUNCE_MS)
  }

  const reportContentBatch = (batchEvents: Event[]) => {
    for (const ev of batchEvents) {
      if (ev.kind !== ExtendedKind.PUBLICATION_CONTENT) continue
      accumulatedContent.set(ev.id, ev)
    }
    options?.onProgress?.(buildProgress())
    scheduleContentRootResolve()
  }

  const batches: Promise<Event[]>[] = []
  let filterCount = 0
  const axes = options?.axis
    ? [options.axis]
    : preferContentRelaySearch
      ? []
      : LIBRARY_PUBLICATION_RELAY_SEARCH_AXES

  if (preferContentRelaySearch) {
    filterCount += 1
    batches.push(
      fetchPublicationContentFromRelays(q, relayUrls, blockedRelays, {
        onPartialEvents: reportContentBatch
      }).catch((e) => {
        if (import.meta.env.DEV) {
          logger.warn('[Library] publication content relay search failed', {
            message: e instanceof Error ? e.message : String(e)
          })
        }
        return [] as Event[]
      })
    )
  }

  for (const axis of axes) {
    const npubQuery = tryNpubFromQuery(q)
    if (npubQuery && axis !== 'author') continue

    if (axis === 'd-tag' || axis === 'title' || (axis === 'author' && npubQuery)) {
      batches.push(
        fetchPublicationIndexesFromDocumentRelays(axis, q, blockedRelays, {
          onPartialEvents: reportBatch
        }).catch(() => [] as Event[])
      )
    }

    const axisFilters = buildLibraryPublicationRelaySearchFiltersForAxis(axis, { query: q })
    const hasNip01Filters = axisFilters.length > 0
    const hasMetadataSearch =
      axis === 'title' || axis === 'd-tag' || (axis === 'author' && !npubQuery)
    if (!hasNip01Filters && !hasMetadataSearch) continue

    filterCount += axisFilters.length

    if (wsRelays.length > 0 && hasNip01Filters) {
      batches.push(
        queryService
          .fetchEvents(wsRelays, axisFilters, {
            globalTimeout: LIBRARY_RELAY_SEARCH_TIMEOUT_MS,
            eoseTimeout: axis === 'd-tag' ? 5_000 : 8_000,
            firstRelayResultGraceMs: axis === 'd-tag' ? 2_000 : false
          })
          .then((events) => filterEventsForPublicationRelaySearchAxis(events, axis, q))
          .then((events) => {
            reportBatch(events)
            return events
          })
          .catch((e) => {
            if (import.meta.env.DEV) {
              logger.warn('[Library] WS publication search failed', {
                axis,
                message: e instanceof Error ? e.message : String(e)
              })
            }
            return [] as Event[]
          })
      )
    }

    for (const httpRelay of httpRelays) {
      if (hasNip01Filters) {
        for (const filter of axisFilters) {
          batches.push(
            queryIndexRelayForLibrary(httpRelay, filter)
              .then((page) =>
                filterEventsForPublicationRelaySearchAxis(page.events as Event[], axis, q)
              )
              .then((events) => {
                reportBatch(events)
                return events
              })
              .catch((e) => {
                if (import.meta.env.DEV) {
                  logger.warn('[Library] HTTP publication filter search failed', {
                    relay: httpRelay,
                    axis,
                    message: e instanceof Error ? e.message : String(e)
                  })
                }
                return [] as Event[]
              })
          )
        }
      }

      if (!hasMetadataSearch) continue

      filterCount += 1
      batches.push(
        searchHttpIndexRelayPublicationAxis(httpRelay, axis, q, {
          allowFullScan: true,
          fullScanMaxPages:
            axis === 'title' ? LIBRARY_TITLE_HTTP_SCAN_MAX_PAGES : LIBRARY_RELAY_SEARCH_SCAN_MAX_PAGES,
          onPartialEvents: reportBatch
        }).catch((e) => {
          if (import.meta.env.DEV) {
            logger.warn('[Library] HTTP publication metadata search failed', {
              relay: httpRelay,
              axis,
              message: e instanceof Error ? e.message : String(e)
            })
          }
          return [] as Event[]
        })
      )
    }
  }

  if (batches.length === 0) {
    options?.onProgress?.(buildProgress())
    return { events: [], entries: [], mergedIndexEvents: context.indexEvents ?? [], fromCache: false }
  }

  options?.onProgress?.(buildProgress())

  await Promise.all(batches)

  if (contentRootResolveTimer !== null) {
    window.clearTimeout(contentRootResolveTimer)
    contentRootResolveTimer = null
  }
  contentRootLookupAbortRef.current?.abort()
  await contentRootResolution

  if (accumulatedContent.size > 0) {
    const resolved = await resolvePublicationIndexRootsForOrphanContentSections(
      accumulatedContent.values(),
      structuralMap,
      httpRelays,
      { query: q }
    )
    if (resolved.fetched.length > 0) {
      for (const ev of resolved.fetched) accumulatedValid.set(ev.id, ev)
      structuralMap = resolved.structuralMap
      await persistRelayDiscoveredLibraryIndexes(resolved.fetched)
    }
  }

  const networkEvents = [...accumulatedValid.values()]
  const valid = filterValidIndexEvents(networkEvents)
  if (valid.length > 0) {
    await persistRelayDiscoveredLibraryIndexes(valid)
  }

  const finalProgress = buildProgress()
  const entries = finalProgress.entries
  const mergedIndex = finalProgress.mergedIndexEvents ?? publicationIndexMapValues(structuralMap)
  const roots = entries.map((entry) => entry.event)

  const searchContext: LibrarySearchContext = {
    indexEvents: mergedIndex,
    engagement
  }
  const relaySearchHit =
    valid.length > 0 || accumulatedContent.size > 0 || entries.length > 0
  // Don't persist an empty content-primary result; it would wrongly mark the query "searched, no hits".
  if (relaySearchHit && !(contentPrimary && entries.length === 0)) {
    putLibrarySearchSessionRow(
      q,
      searchContext,
      {
        entries,
        mergedIndexEvents: mergedIndex,
        relaySearched: true
      },
      options?.axis
    )
  }

  options?.onProgress?.(finalProgress)

  if (import.meta.env.DEV) {
    logger.info('[Library] relay search done', {
      axes: axes.length,
      contentRelaySearch: preferContentRelaySearch,
      filters: filterCount,
      batches: batches.length,
      network: networkEvents.length,
      contentNetwork: accumulatedContent.size,
      valid: valid.length,
      roots: roots.length
    })
  }

  return { events: valid, entries, mergedIndexEvents: mergedIndex, fromCache: false }
}

export function filterLibraryPublicationsBySearch(
  entries: LibraryPublicationEntry[],
  query: string
): LibraryPublicationEntry[] {
  const q = query.trim()
  if (!q) return entries

  const npub = tryNpubFromQuery(q)
  if (npub) {
    return entries.filter(({ event }) => event.pubkey.toLowerCase() === npub)
  }

  return entries.filter(({ event }) => publicationIndexMatchesSearchQuery(event, q))
}

export function filterLibraryPublicationsByUser(
  entries: LibraryPublicationEntry[],
  userPubkey: string | null | undefined,
  opts?: {
    bookmarkListEvent?: Event | null
    pinListEvent?: Event | null
    myBooklistAddresses?: Set<string>
    myBooklistEventIds?: Set<string>
  }
): LibraryPublicationEntry[] {
  if (!userPubkey) return entries
  return entries.filter((entry) =>
    publicationEntryBelongsToUser(entry, {
      userPubkey,
      bookmarkListEvent: opts?.bookmarkListEvent,
      pinListEvent: opts?.pinListEvent,
      myBooklistAddresses: opts?.myBooklistAddresses,
      myBooklistEventIds: opts?.myBooklistEventIds
    })
  )
}

/** Capped address + event-id targets for label/comment/highlight relay queries. */
export function collectEngagementTargets(
  indexEvents: Event[],
  indexByAddress: Map<string, Event>
): { addresses: Set<string>; eventIds: Set<string> } {
  const addresses = new Set<string>()
  const eventIds = new Set<string>()
  outer: for (const root of getTopLevelIndexEvents(indexEvents)) {
    eventIds.add(root.id.toLowerCase())
    if (eventIds.size >= MAX_TARGET_EVENT_IDS) break

    for (const addr of collectReachableAddressesCached(root, indexByAddress)) {
      addresses.add(addr)
      const indexed = indexByAddress.get(addr)
      if (indexed) eventIds.add(indexed.id.toLowerCase())
      if (addresses.size >= MAX_TARGET_ADDRESSES || eventIds.size >= MAX_TARGET_EVENT_IDS) {
        break outer
      }
    }
    const rootAddr = eventTagAddress(root)
    if (rootAddr) {
      addresses.add(rootAddr)
      if (addresses.size >= MAX_TARGET_ADDRESSES || eventIds.size >= MAX_TARGET_EVENT_IDS) {
        break outer
      }
    }
  }
  return { addresses, eventIds }
}

function limitEngagementChunks<T>(chunks: T[][]): T[][] {
  return chunks.length <= MAX_ENGAGEMENT_HTTP_CHUNKS
    ? chunks
    : chunks.slice(0, MAX_ENGAGEMENT_HTTP_CHUNKS)
}

async function withEngagementTimeout<T>(
  promise: Promise<T>,
  fallback: T,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          if (import.meta.env.DEV) {
            logger.warn('[Library] engagement fetch timed out', { label, ms: ENGAGEMENT_FETCH_TIMEOUT_MS })
          }
          resolve(fallback)
        }, ENGAGEMENT_FETCH_TIMEOUT_MS)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function buildFeedFromIndex(
  indexEvents: Event[],
  indexByAddress: Map<string, Event>
): LibraryPublicationEntry[] {
  return pickLibraryPublicationEntries(
    getTopLevelIndexEvents(indexEvents),
    indexByAddress,
    emptyPublicationEngagementMaps()
  )
}

export async function loadLibraryPublicationIndex(
  relayUrls: string[],
  options?: {
    forceRefresh?: boolean
    viewerPubkey?: string | null
    /** Called as soon as kind-30040 indexes are loaded — before engagement (which can take minutes). */
    onIndexesReady?: (snapshot: LibraryIndexLoadSnapshot) => void
  }
): Promise<LibraryIndexLoadResult> {
  const relayKey = relaySetKey(relayUrls)
  const forceRefresh = options?.forceRefresh ?? false

  if (!forceRefresh && indexLoadJob?.relayKey === relayKey && !indexLoadJob.forceRefresh) {
    registerIndexesReadyListener(indexLoadJob, options?.onIndexesReady)
    if (import.meta.env.DEV) {
      logger.info('[Library] load joined in-flight', {
        relayCount: relayUrls.length,
        hasProgress: indexLoadJob.lastProgressIndex != null
      })
    }
    return indexLoadJob.promise
  }

  const job: LibraryIndexLoadJob = {
    relayKey,
    forceRefresh,
    onIndexesReadyListeners: [],
    lastProgressIndex: null,
    promise: Promise.resolve(null as unknown as LibraryIndexLoadResult)
  }
  registerIndexesReadyListener(job, options?.onIndexesReady)
  indexLoadJob = job
  job.promise = runLibraryPublicationIndexLoad(relayUrls, options, job).finally(() => {
    if (indexLoadJob === job) indexLoadJob = null
  })
  return job.promise
}

async function runLibraryPublicationIndexLoad(
  relayUrls: string[],
  options: {
    forceRefresh?: boolean
    viewerPubkey?: string | null
    onIndexesReady?: (snapshot: LibraryIndexLoadSnapshot) => void
  } | undefined,
  job: LibraryIndexLoadJob
): Promise<LibraryIndexLoadResult> {
  const key = job.relayKey
  const viewerPubkey = options?.viewerPubkey ?? null
  if (import.meta.env.DEV) {
    logger.info('[Library] load start', { relayCount: relayUrls.length, cached: sessionCache?.relayKey === key })
  }

  const emitIndexesReady = (indexByAddress: PublicationIndexMap) => {
    job.lastProgressIndex = indexByAddress
    emitIndexesReadySnapshot(job.onIndexesReadyListeners, indexByAddress)
  }

  const engagement = emptyPublicationEngagementMaps()

  if (!options?.forceRefresh && sessionCache?.relayKey === key) {
    const cachedIndexEvents = indexEventsFromCache(sessionCache)
    sessionCache = { ...sessionCache, viewerPubkey, engagement }
    const engaged = buildFeedFromIndex(cachedIndexEvents, sessionCache.indexByAddress)
    if (import.meta.env.DEV) {
      logger.info('[Library] load from session cache', { engaged: engaged.length })
    }
    emitIndexesReady(sessionCache.indexByAddress)
    return {
      engaged,
      allIndexCount: cachedIndexEvents.length,
      topLevelCount: getTopLevelIndexEventsFromMap(sessionCache.indexByAddress).length,
      indexEvents: cachedIndexEvents,
      engagement
    }
  }

  const cached = await loadLibraryIndexCacheEvents()
  let indexByAddress = buildStructuralPublicationIndexMap(cached)
  let indexEvents = publicationIndexMapValues(indexByAddress)
  let topLevelCount = getTopLevelIndexEventsFromMap(indexByAddress).length
  emitIndexesReady(indexByAddress)

  if (import.meta.env.DEV) {
    logger.info('[Library] local index ready', {
      cachedCount: cached.length,
      topLevelCount
    })
  }

  const needsRelayTopUp = options?.forceRefresh || topLevelCount < LIBRARY_PAGE_SIZE
  if (needsRelayTopUp) {
    indexEvents = await fetchLibraryIndexEvents(relayUrls, {
      firstPageOnly: true,
      onProgress: (events) => emitIndexesReady(buildStructuralPublicationIndexMap(events))
    })
    indexByAddress = buildStructuralPublicationIndexMap(indexEvents)
    topLevelCount = getTopLevelIndexEventsFromMap(indexByAddress).length
    if (import.meta.env.DEV) {
      logger.info('[Library] relay top-up done', {
        indexCount: indexEvents.length,
        topLevelCount
      })
    }
  }

  // Pick up relay-discovered rows that finished persisting while this load was in flight.
  const freshCached = await loadLibraryIndexCacheEvents()
  if (freshCached.length > 0) {
    indexByAddress = mergePublicationIndexMaps(indexByAddress, freshCached)
    indexEvents = publicationIndexMapValues(indexByAddress)
    topLevelCount = getTopLevelIndexEventsFromMap(indexByAddress).length
  }

  sessionCache = { relayKey: key, viewerPubkey, indexByAddress, engagement }
  const engaged = buildFeedFromIndex(indexEvents, indexByAddress)

  if (import.meta.env.DEV) {
    logger.info('[Library] load done', {
      engaged: engaged.length,
      topLevel: topLevelCount,
      allIndexCount: indexEvents.length,
      relayTopUp: needsRelayTopUp
    })
  }

  return {
    engaged,
    allIndexCount: indexEvents.length,
    topLevelCount,
    indexEvents,
    engagement
  }
}

export function clearLibraryPublicationIndexCache(): void {
  sessionCache = null
  indexLoadJob = null
  clearLibrarySearchSessionCache()
}

/** Clears Library tab session cache and relay-discovered catalog masters (opened publications stay). */
export async function clearAllLibraryIndexCaches(): Promise<void> {
  sessionCache = null
  indexLoadJob = null
  clearLibrarySearchSessionCache()
  await clearLibraryIndexIdbCache()
}

/**
 * When opening a publication from Library, seed session cache and the publication events store
 * so offline re-read works even if the index lived only in the Library LRU store.
 */
export function persistLibraryPublicationForReading(event: Event): void {
  if (event.kind !== ExtendedKind.PUBLICATION) return
  client.addEventToCache(event)
  void indexedDb.putReplaceableEvent(event).catch(() => {})
}
