import { ExtendedKind, LIBRARY_RELAY_URLS } from '@/constants'
import {
  eventMatchesGeneralSearchQuery,
  generalSearchHaystack,
  generalSearchQueryTerms,
  normalizeGeneralSearchQuery
} from '@/lib/general-search-text-match'
import { normalizeToDTag, parseAdvancedSearch } from '@/lib/search-parser'
import logger from '@/lib/logger'
import { extractNip32LabelValues, isBooklistNip32Label } from '@/lib/nip32-label'
import { queryIndexRelay, queryIndexRelayForLibrary, queryIndexRelayPublicationSearch } from '@/lib/index-relay-http'
import {
  buildIndexByAddress,
  collectPublicationIndexEventIds,
  collectReachableAddressesCached,
  eventTagAddress,
  filterValidIndexEvents,
  getReferencedChild30040Addresses,
  getTopLevelIndexEvents,
  hydrateNestedIndexEvents
} from '@/lib/publication-index'
import { getReplaceableCoordinateFromEvent, isReplaceableEvent } from '@/lib/event'
import { isEventInPinList } from '@/lib/replaceable-list-latest'
import { buildComprehensiveRelayList } from '@/lib/relay-list-builder'
import {
  clearLibraryIndexIdbCache,
  loadLibraryIndexCacheEvents,
  persistLibraryIndexCacheEvents
} from '@/lib/library-index-idb-cache'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import {
  canonicalRelaySessionKey,
  httpIndexBasesForRelayQuery,
  normalizeHttpRelayUrl,
  normalizeUrl
} from '@/lib/url'
import { queryService } from '@/services/client.service'
import type { Event, Filter } from 'nostr-tools'
import { kinds, nip19 } from 'nostr-tools'

const INDEX_FETCH_LIMIT = 500
const INDEX_HTTP_PAGE_LIMIT = 100
const INDEX_HTTP_MAX_PAGES = 5
const ENGAGEMENT_ADDRESS_CHUNK = 36
const ENGAGEMENT_EVENT_ID_CHUNK = 44
const MAX_TARGET_ADDRESSES = 480
const HYDRATE_MISSING_CAP = 64
export const LIBRARY_RECENT_FALLBACK_LIMIT = 120
const ENGAGEMENT_FETCH_TIMEOUT_MS = 25_000
const LIBRARY_SEARCH_READING_CACHE_LIMIT = 200
export const LIBRARY_RELAY_SEARCH_LIMIT = 100
const LIBRARY_RELAY_SEARCH_TIMEOUT_MS = 28_000
const QUERY_OPTS = {
  globalTimeout: 18_000,
  eoseTimeout: 3_000,
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
  highlightAddresses: Set<string>
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
  engagementCount: number
}

type LibraryIndexCache = {
  relayKey: string
  viewerPubkey: string | null
  indexEvents: Event[]
  indexByAddress: Map<string, Event>
  engagement: PublicationEngagementMaps
}

let sessionCache: LibraryIndexCache | null = null

type LibrarySearchSessionRow = {
  fingerprint: string
  entries: LibraryPublicationEntry[]
  mergedIndexEvents: Event[]
  relaySearched: boolean
}

const librarySearchSessionCache = new Map<string, LibrarySearchSessionRow>()

function librarySearchQueryKey(query: string): string {
  return normalizeGeneralSearchQuery(query).toLowerCase()
}

function librarySearchFingerprint(context: LibrarySearchContext): string {
  const engagement = context.engagement
  const engagementSize = engagement
    ? engagement.labelAddresses.size +
      engagement.labelEventIds.size +
      engagement.commentAddresses.size +
      engagement.highlightAddresses.size
    : 0
  return `${context.indexEvents.length}:${engagementSize}`
}

function getLibrarySearchSessionRow(
  query: string,
  context: LibrarySearchContext,
  opts?: { requireRelaySearch?: boolean }
): LibrarySearchSessionRow | null {
  const key = librarySearchQueryKey(query)
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
  row: Omit<LibrarySearchSessionRow, 'fingerprint'>
): void {
  const key = librarySearchQueryKey(query)
  if (!key) return
  librarySearchSessionCache.set(key, {
    ...row,
    fingerprint: librarySearchFingerprint(context)
  })
}

/** Sync read of cached search hits for the current index + engagement snapshot. */
export function peekLibrarySearchResults(
  query: string,
  context: LibrarySearchContext
): LibraryPublicationEntry[] | null {
  return getLibrarySearchSessionRow(query, context)?.entries ?? null
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
    if (!prev || ev.created_at > prev.created_at) byId.set(ev.id, ev)
  }
  return [...byId.values()]
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function fetchPaginatedFromHttpIndexRelay(baseUrl: string, filter: Filter): Promise<Event[]> {
  const out: Event[] = []
  const seen = new Set<string>()
  let until: number | undefined

  for (let page = 0; page < INDEX_HTTP_MAX_PAGES; page++) {
    const pageFilter: Filter = {
      ...filter,
      limit: INDEX_HTTP_PAGE_LIMIT,
      ...(until != null ? { until } : {})
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

    let oldest = batch[0]?.created_at ?? Number.MAX_SAFE_INTEGER
    for (const ev of batch) {
      if (ev.created_at < oldest) oldest = ev.created_at
      if (seen.has(ev.id)) continue
      seen.add(ev.id)
      out.push(ev)
    }

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

function libraryIndexRelayUrls(extraRelayUrls: string[] = []): string[] {
  const base = LIBRARY_RELAY_URLS.map(normalizeLibraryRelayUrl).filter(Boolean)
  const extra = extraRelayUrls.map(normalizeLibraryRelayUrl).filter(Boolean)
  return [...new Set([...base, ...extra])]
}

export async function buildLibraryRelayUrls(userPubkey?: string): Promise<string[]> {
  const base = libraryIndexRelayUrls()
  const urls = await buildComprehensiveRelayList({
    userPubkey,
    includeUserOwnRelays: true,
    includeFastReadRelays: false,
    includeSearchableRelays: false,
    includeFavoriteRelays: false,
    relayHints: base
  })
  return libraryIndexRelayUrls([...urls])
}

export async function fetchLibraryIndexEvents(relayUrls: string[]): Promise<Event[]> {
  const indexRelays = libraryIndexRelayUrls(relayUrls)
  if (indexRelays.length === 0) return []

  const cached = await loadLibraryIndexCacheEvents()
  const filter: Filter = { kinds: [ExtendedKind.PUBLICATION], limit: INDEX_FETCH_LIMIT }
  const { wsRelays, httpRelays } = splitWsAndHttpRelays(indexRelays)

  const batches: Promise<Event[]>[] = []
  if (wsRelays.length > 0) {
    batches.push(
      queryService.fetchEvents(wsRelays, [filter], QUERY_OPTS).catch((e) => {
        if (import.meta.env.DEV) {
          logger.warn('[Library] WS index fetch failed', {
            message: e instanceof Error ? e.message : String(e)
          })
        }
        return [] as Event[]
      })
    )
  }
  for (const httpRelay of httpRelays) {
    batches.push(fetchPaginatedFromHttpIndexRelay(httpRelay, filter))
  }

  const settled = await Promise.allSettled(batches)
  const networkMerged = dedupeEventsById(
    settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
  )
  const merged = dedupeEventsById([...cached, ...networkMerged])
  const valid = filterValidIndexEvents(merged)
  void persistLibraryIndexCacheEvents(valid)
  if (import.meta.env.DEV) {
    logger.info('[Library] index fetch', {
      indexRelays: indexRelays.length,
      wsRelays: wsRelays.length,
      httpRelays: httpRelays.length,
      cachedCount: cached.length,
      networkCount: networkMerged.length,
      mergedCount: merged.length,
      validCount: valid.length
    })
  }
  return valid
}

export function buildEngagementMapsFromEvents(
  labels: Event[],
  comments: Event[],
  highlights: Event[],
  targetAddresses?: Set<string>,
  targetEventIds?: Set<string>,
  viewerPubkey?: string | null
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
  const highlightAddresses = new Set<string>()

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
      if (tag[0] === 'e' && tag[1] && eventIdMatches(tag[1]) && isViewerEvent) {
        myCommentEventIds.add(tag[1].toLowerCase())
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
      if (tag[0] === 'e' && tag[1] && eventIdMatches(tag[1]) && isViewerEvent) {
        myHighlightEventIds.add(tag[1].toLowerCase())
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
    highlightAddresses
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

export async function fetchPublicationEngagementMaps(
  relayUrls: string[],
  targetAddresses: Set<string>,
  targetEventIds: Set<string>,
  options?: { httpOnly?: boolean; viewerPubkey?: string | null }
): Promise<PublicationEngagementMaps> {
  if (relayUrls.length === 0 || targetAddresses.size === 0) {
    return emptyPublicationEngagementMaps()
  }

  const addressChunks = chunkArray([...targetAddresses], ENGAGEMENT_ADDRESS_CHUNK)
  const eventIdChunks = chunkArray([...targetEventIds], ENGAGEMENT_EVENT_ID_CHUNK)
  const { wsRelays, httpRelays } = splitWsAndHttpRelays(relayUrls)
  /** Labels/comments/highlights often live on WS relays only — always query them when available. */
  const useWsEngagement = wsRelays.length > 0

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

  const highlightPromise = Promise.all([
    useWsEngagement && highlightFilters.length > 0
      ? queryService.fetchEvents(wsRelays, highlightFilters, QUERY_OPTS)
      : Promise.resolve([] as Event[]),
    fetchHttpEngagementByAddresses(httpRelays, kinds.Highlights, '#a', addressChunks)
  ]).then(([scoped, bulk]) => dedupeEventsById([...scoped, ...bulk]))

  const labelPromise = Promise.all([
    useWsEngagement && labelAddressFilters.length > 0
      ? queryService.fetchEvents(wsRelays, labelAddressFilters, QUERY_OPTS)
      : Promise.resolve([] as Event[]),
    useWsEngagement && labelEventFilters.length > 0
      ? queryService.fetchEvents(wsRelays, labelEventFilters, QUERY_OPTS)
      : Promise.resolve([] as Event[]),
    fetchHttpEngagementByAddresses(httpRelays, ExtendedKind.LABEL, '#a', addressChunks)
  ]).then(([byAddress, byEvent, bulk]) => dedupeEventsById([...byAddress, ...byEvent, ...bulk]))

  const commentPromise = Promise.all([
    useWsEngagement && commentWsFilters.length > 0
      ? queryService.fetchEvents(wsRelays, commentWsFilters, QUERY_OPTS)
      : Promise.resolve([] as Event[]),
    fetchHttpEngagementByAddresses(httpRelays, ExtendedKind.COMMENT, '#A', addressChunks)
  ]).then(([scoped, bulk]) => dedupeEventsById([...scoped, ...bulk]))

  const [highlights, labels, comments] = await Promise.all([
    highlightPromise,
    labelPromise,
    commentPromise
  ])

  return buildEngagementMapsFromEvents(
    dedupeEventsById(labels),
    dedupeEventsById(comments),
    dedupeEventsById(highlights),
    targetAddresses,
    targetEventIds,
    options?.viewerPubkey
  )
}

function addressHasEngagement(
  address: string,
  eventId: string | undefined,
  maps: PublicationEngagementMaps
): { hasLabel: boolean; hasComment: boolean; hasHighlight: boolean } {
  const hasLabel =
    maps.labelAddresses.has(address) ||
    (eventId ? maps.labelEventIds.has(eventId.toLowerCase()) : false)
  const hasComment = maps.commentAddresses.has(address)
  const hasHighlight = maps.highlightAddresses.has(address)
  return { hasLabel, hasComment, hasHighlight }
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
    if (flags.hasLabel || flags.hasComment || flags.hasHighlight) engagementCount++
  }

  const rootFlags = addressHasEngagement(rootAddr ?? '', root.id, engagement)
  const rootBooklistFlags = collectBooklistFlagsForTarget(rootAddr ?? '', root.id, engagement)
  const rootMyFlags = collectMyEngagementFlagsForTarget(rootAddr ?? '', root.id, engagement)
  hasLabel = hasLabel || rootFlags.hasLabel
  hasComment = hasComment || rootFlags.hasComment
  hasHighlight = hasHighlight || rootFlags.hasHighlight
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
    .filter((entry) => entry.hasLabel || entry.hasComment || entry.hasHighlight)
}

export function buildRecentPublicationEntries(
  roots: Event[],
  indexByAddress: Map<string, Event>,
  engagement: PublicationEngagementMaps,
  limit = LIBRARY_RECENT_FALLBACK_LIMIT
): LibraryPublicationEntry[] {
  return [...getTopLevelIndexEvents(roots)]
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((event) => buildLibraryPublicationEntry(event, indexByAddress, engagement))
}

/** Engaged publications first; when none match, show the newest top-level indexes (still enriched). */
export function pickLibraryPublicationEntries(
  roots: Event[],
  indexByAddress: Map<string, Event>,
  engagement: PublicationEngagementMaps
): LibraryPublicationEntry[] {
  const enriched = getTopLevelIndexEvents(roots).map((root) =>
    buildLibraryPublicationEntry(root, indexByAddress, engagement)
  )
  const engaged = enriched.filter((entry) => entry.hasLabel || entry.hasComment || entry.hasHighlight)
  if (engaged.length > 0) return sortLibraryPublications(engaged)
  return sortLibraryPublications(buildRecentPublicationEntries(roots, indexByAddress, engagement))
}

export function sortLibraryPublications(entries: LibraryPublicationEntry[]): LibraryPublicationEntry[] {
  return [...entries].sort((a, b) => {
    if (a.hasLabel !== b.hasLabel) return a.hasLabel ? -1 : 1
    if (a.engagementCount !== b.engagementCount) return b.engagementCount - a.engagementCount
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
    highlightAddresses: new Set()
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
  }
): boolean {
  const { event } = entry
  const pk = opts.userPubkey.toLowerCase()
  if (event.pubkey.toLowerCase() === pk) return true
  if (event.tags.some((t) => t[0] === 'p' && t[1]?.toLowerCase() === pk)) return true
  if (entry.hasMyBooklistLabel || entry.hasMyComment || entry.hasMyHighlight) return true
  if (opts.bookmarkListEvent && isEventInBookmarkList(opts.bookmarkListEvent, event)) return true
  if (opts.pinListEvent && isEventInPinList(opts.pinListEvent, event)) return true
  return false
}

/** Haystack for kind-30040 index search: general fields plus section refs and language tags. */
export function publicationIndexSearchHaystack(event: Event): string {
  const base = generalSearchHaystack(event)
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
  if (eventMatchesGeneralSearchQuery(event, query)) return true
  if (event.kind !== ExtendedKind.PUBLICATION) return false

  const raw = query.trim()
  if (!raw) return false

  const haystack = publicationIndexSearchHaystack(event)
  const normalized = normalizeGeneralSearchQuery(raw).toLowerCase()
  const qSpace = normalized.replace(/-/g, ' ')
  const needles = qSpace !== normalized ? [normalized, qSpace] : [normalized]
  for (const needle of needles) {
    if (needle && haystack.includes(needle)) return true
  }

  const words = generalSearchQueryTerms(raw)
  if (words.length >= 2 && words.every((w) => haystack.includes(w))) return true
  return false
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

function libraryEntriesFromRoots(
  roots: Event[],
  indexByAddress: Map<string, Event>,
  engagement: PublicationEngagementMaps
): LibraryPublicationEntry[] {
  return roots.map((root) => {
    const engaged = filterEngagedPublications([root], indexByAddress, engagement)
    if (engaged.length > 0) return engaged[0]
    return {
      event: root,
      hasLabel: false,
      labelNames: [],
      hasBooklistLabel: false,
      hasMyBooklistLabel: false,
      hasComment: false,
      hasHighlight: false,
      engagementCount: 0
    }
  })
}

/** Re-fetch engagement maps for the current library index snapshot (e.g. after booklist toggle). */
export async function refreshLibraryEngagement(
  relayUrls: string[],
  indexEvents: Event[],
  viewerPubkey?: string | null
): Promise<{ engagement: PublicationEngagementMaps; engaged: LibraryPublicationEntry[] }> {
  const indexByAddress = buildIndexByAddress(indexEvents)
  const targetAddresses = collectTargetAddressesFromIndexes(indexEvents, indexByAddress)
  const targetEventIds = collectPublicationIndexEventIds(indexEvents)
  const engagement = await fetchPublicationEngagementMaps(relayUrls, targetAddresses, targetEventIds, {
    httpOnly: true,
    viewerPubkey
  })
  const topLevel = getTopLevelIndexEvents(indexEvents)
  if (sessionCache) {
    sessionCache = { ...sessionCache, engagement, viewerPubkey: viewerPubkey ?? null }
  }
  return {
    engagement,
    engaged: pickLibraryPublicationEntries(topLevel, indexByAddress, engagement)
  }
}

/** Search all cached kind-30040 indexes (library index store), mapping nested hits to top-level roots. */
export function searchLibraryPublicationIndex(
  query: string,
  indexEvents: Event[],
  indexByAddress: Map<string, Event>
): Event[] {
  const q = query.trim()
  if (!q || indexEvents.length === 0) return []

  const topLevel = getTopLevelIndexEvents(indexEvents)
  const topLevelIds = new Set(topLevel.map((ev) => ev.id))
  const addressToRoot = buildAddressToRootMap(topLevel, indexByAddress)
  const roots = new Map<string, Event>()

  for (const ev of indexEvents) {
    if (ev.kind !== ExtendedKind.PUBLICATION) continue
    if (!publicationIndexMatchesSearchQuery(ev, q)) continue

    if (topLevelIds.has(ev.id)) {
      roots.set(ev.id, ev)
      continue
    }

    const addr = eventTagAddress(ev)
    const root = addr ? addressToRoot.get(addr) : undefined
    if (root) roots.set(root.id, root)
  }

  return [...roots.values()]
}

export type LibrarySearchContext = {
  indexEvents: Event[]
  engagement?: PublicationEngagementMaps
}

/**
 * Search publications across the library index cache (all loaded kind-30040 rows) and the
 * publication reading cache ({@link StoreNames.PUBLICATION_EVENTS}).
 */
export async function searchLibraryPublications(
  query: string,
  context: LibrarySearchContext
): Promise<LibraryPublicationEntry[]> {
  const q = query.trim()
  if (!q) return []

  const cached = getLibrarySearchSessionRow(q, context)
  if (cached) {
    if (import.meta.env.DEV) {
      logger.info('[Library] search cache hit', { query: q, relaySearched: cached.relaySearched })
    }
    return cached.entries
  }

  let indexEvents = context.indexEvents
  if (indexEvents.length === 0) {
    const cachedIndex = await loadLibraryIndexCacheEvents()
    indexEvents = filterValidIndexEvents(cachedIndex)
  }

  const engagement = context.engagement ?? EMPTY_ENGAGEMENT
  const indexByAddress = buildIndexByAddress(indexEvents)
  const fromIndex = searchLibraryPublicationIndex(q, indexEvents, indexByAddress)
  const rootMap = new Map<string, Event>()
  for (const root of fromIndex) rootMap.set(root.id, root)

  const topLevel = getTopLevelIndexEvents(indexEvents)
  const addressToRoot = buildAddressToRootMap(topLevel, indexByAddress)

  try {
    const fromReadingCache = await indexedDb.getCachedEventsForSearch(
      q,
      LIBRARY_SEARCH_READING_CACHE_LIMIT,
      [ExtendedKind.PUBLICATION],
      { scanBudget: 12_000, collectCap: 400 }
    )
    for (const ev of fromReadingCache) {
      if (ev.kind !== ExtendedKind.PUBLICATION) continue
      if (!publicationIndexMatchesSearchQuery(ev, q)) continue
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

  const roots = [...rootMap.values()]
  const entries = sortLibraryPublications(libraryEntriesFromRoots(roots, indexByAddress, engagement))

  const searchContext: LibrarySearchContext = { indexEvents, engagement }
  const prev = getLibrarySearchSessionRow(q, searchContext)
  putLibrarySearchSessionRow(q, searchContext, {
    entries,
    mergedIndexEvents: prev?.mergedIndexEvents ?? indexEvents,
    relaySearched: prev?.relaySearched ?? false
  })

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

/**
 * OR-merge REQ filters for kind **30040** publication indexes: `#d` slugs plus NIP-50 `search`
 * (title, author, summary/description on index relays).
 */
export function buildLibraryPublicationRelaySearchFilters(opts: {
  query: string
  limit?: number
}): Filter[] {
  const searchRaw = opts.query.trim()
  if (!searchRaw) return []

  const limit = Math.max(1, Math.min(opts.limit ?? LIBRARY_RELAY_SEARCH_LIMIT, 100))
  const kind = ExtendedKind.PUBLICATION
  const seen = new Set<string>()
  const out: Filter[] = []
  const add = (filter: Filter) => {
    const key = JSON.stringify(filter)
    if (seen.has(key)) return
    seen.add(key)
    out.push(filter)
  }

  const npub = tryNpubFromQuery(searchRaw)
  if (npub) {
    add({ kinds: [kind], authors: [npub], limit })
    return out
  }

  const dTags = publicationQueryDTagVariants(searchRaw)
  if (dTags.length > 0) {
    add({ kinds: [kind], '#d': dTags, limit })
  }

  const searchNorm = normalizeGeneralSearchQuery(searchRaw)
  add({ kinds: [kind], search: searchRaw, limit })
  if (searchNorm !== searchRaw) {
    add({ kinds: [kind], search: searchNorm, limit })
  }

  const adv = parseAdvancedSearch(searchRaw)
  const titleValues = adv.title
    ? Array.isArray(adv.title)
      ? adv.title
      : [adv.title]
    : []
  for (const title of titleValues) {
    const t = title.trim()
    if (!t) continue
    add({ kinds: [kind], search: t, limit })
    const titleDTags = publicationQueryDTagVariants(t)
    if (titleDTags.length > 0) {
      add({ kinds: [kind], '#d': titleDTags, limit })
    }
  }

  const authorValues = adv.author
    ? Array.isArray(adv.author)
      ? adv.author
      : [adv.author]
    : []
  for (const author of authorValues) {
    const a = author.trim()
    if (a) add({ kinds: [kind], search: a, limit })
  }

  const descriptionValues = adv.description
    ? Array.isArray(adv.description)
      ? adv.description
      : [adv.description]
    : []
  for (const description of descriptionValues) {
    const d = description.trim()
    if (d) add({ kinds: [kind], search: d, limit })
  }

  return out
}

/** Query document relays for kind-30040 indexes matching {@link buildLibraryPublicationRelaySearchFilters}. */
export async function searchLibraryPublicationsOnRelays(
  query: string,
  relayUrls: string[],
  context: LibrarySearchContext,
  options?: { forceRefresh?: boolean }
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

  if (!options?.forceRefresh) {
    const cached = getLibrarySearchSessionRow(q, context, { requireRelaySearch: true })
    if (cached) {
      if (import.meta.env.DEV) {
        logger.info('[Library] relay search cache hit', { query: q })
      }
      return {
        events: [],
        entries: cached.entries,
        mergedIndexEvents: cached.mergedIndexEvents,
        fromCache: true
      }
    }
  }

  const filters = buildLibraryPublicationRelaySearchFilters({ query: q })
  if (filters.length === 0) {
    return { events: [], entries: [], mergedIndexEvents: context.indexEvents ?? [], fromCache: false }
  }

  const indexRelays = libraryIndexRelayUrls(relayUrls)
  const { wsRelays, httpRelays } = splitWsAndHttpRelays(indexRelays)
  const batches: Promise<Event[]>[] = []

  if (wsRelays.length > 0) {
    batches.push(
      queryService
        .fetchEvents(wsRelays, filters, {
          globalTimeout: LIBRARY_RELAY_SEARCH_TIMEOUT_MS,
          eoseTimeout: 8_000,
          firstRelayResultGraceMs: false
        })
        .catch((e) => {
          if (import.meta.env.DEV) {
            logger.warn('[Library] WS publication search failed', {
              message: e instanceof Error ? e.message : String(e)
            })
          }
          return [] as Event[]
        })
    )
  }

  for (const httpRelay of httpRelays) {
    for (const filter of filters) {
      batches.push(
        queryIndexRelayPublicationSearch(httpRelay, filter)
          .then((page) => page.events as Event[])
          .catch((e) => {
            if (import.meta.env.DEV) {
              logger.warn('[Library] HTTP publication search failed', {
                relay: httpRelay,
                message: e instanceof Error ? e.message : String(e)
              })
            }
            return [] as Event[]
          })
      )
    }
  }

  const settled = await Promise.all(batches)
  const networkEvents = dedupeEventsById(settled.flat())
  const valid = filterValidIndexEvents(networkEvents)
  if (valid.length > 0) {
    void persistLibraryIndexCacheEvents(valid)
  }

  const mergedIndex = dedupeEventsById([...(context.indexEvents ?? []), ...valid])
  const indexByAddress = buildIndexByAddress(mergedIndex)
  const roots = searchLibraryPublicationIndex(q, mergedIndex, indexByAddress)
  const engagement = context.engagement ?? EMPTY_ENGAGEMENT
  const entries = sortLibraryPublications(
    libraryEntriesFromRoots(roots, indexByAddress, engagement)
  )

  const searchContext: LibrarySearchContext = {
    indexEvents: mergedIndex,
    engagement
  }
  putLibrarySearchSessionRow(q, searchContext, {
    entries,
    mergedIndexEvents: mergedIndex,
    relaySearched: true
  })

  if (import.meta.env.DEV) {
    logger.info('[Library] relay search done', {
      filters: filters.length,
      network: networkEvents.length,
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
  }
): LibraryPublicationEntry[] {
  if (!userPubkey) return entries
  return entries.filter((entry) =>
    publicationEntryBelongsToUser(entry, {
      userPubkey,
      bookmarkListEvent: opts?.bookmarkListEvent,
      pinListEvent: opts?.pinListEvent
    })
  )
}

function collectTargetAddressesFromIndexes(
  indexEvents: Event[],
  indexByAddress: Map<string, Event>
): Set<string> {
  const addresses = new Set<string>()
  outer: for (const root of getTopLevelIndexEvents(indexEvents)) {
    for (const addr of collectReachableAddressesCached(root, indexByAddress)) {
      addresses.add(addr)
      if (addresses.size >= MAX_TARGET_ADDRESSES) break outer
    }
    const rootAddr = eventTagAddress(root)
    if (rootAddr) {
      addresses.add(rootAddr)
      if (addresses.size >= MAX_TARGET_ADDRESSES) break outer
    }
  }
  return addresses
}

async function buildEngagedFromCache(
  relayUrls: string[],
  indexEvents: Event[],
  indexByAddress: Map<string, Event>,
  engagement?: PublicationEngagementMaps
): Promise<LibraryPublicationEntry[]> {
  const topLevel = getTopLevelIndexEvents(indexEvents)
  let maps = engagement
  if (!maps) {
    const targetAddresses = collectTargetAddressesFromIndexes(indexEvents, indexByAddress)
    const targetEventIds = collectPublicationIndexEventIds(indexEvents)
    maps = await fetchPublicationEngagementMaps(relayUrls, targetAddresses, targetEventIds)
  }
  return pickLibraryPublicationEntries(topLevel, indexByAddress, maps)
}

export async function loadLibraryPublicationIndex(
  relayUrls: string[],
  options?: {
    forceRefresh?: boolean
    viewerPubkey?: string | null
    /** Called as soon as kind-30040 indexes are loaded — before engagement (which can take minutes). */
    onIndexesReady?: (snapshot: {
      engaged: LibraryPublicationEntry[]
      allIndexCount: number
      topLevelCount: number
      indexEvents: Event[]
    }) => void
  }
): Promise<{
  engaged: LibraryPublicationEntry[]
  allIndexCount: number
  topLevelCount: number
  indexEvents: Event[]
  engagement: PublicationEngagementMaps
}> {
  const key = relaySetKey(relayUrls)
  const viewerPubkey = options?.viewerPubkey ?? null
  if (import.meta.env.DEV) {
    logger.info('[Library] load start', { relayCount: relayUrls.length, cached: sessionCache?.relayKey === key })
  }

  if (!options?.forceRefresh && sessionCache?.relayKey === key) {
    if (sessionCache.viewerPubkey !== viewerPubkey) {
      const targetAddresses = collectTargetAddressesFromIndexes(
        sessionCache.indexEvents,
        sessionCache.indexByAddress
      )
      const targetEventIds = collectPublicationIndexEventIds(sessionCache.indexEvents)
      sessionCache = {
        ...sessionCache,
        viewerPubkey,
        engagement: await fetchPublicationEngagementMaps(
          relayUrls,
          targetAddresses,
          targetEventIds,
          { httpOnly: true, viewerPubkey }
        )
      }
    }
    const engaged = await buildEngagedFromCache(
      relayUrls,
      sessionCache.indexEvents,
      sessionCache.indexByAddress,
      sessionCache.engagement
    )
    if (import.meta.env.DEV) {
      logger.info('[Library] load from cache', { engaged: engaged.length })
    }
    return {
      engaged,
      allIndexCount: sessionCache.indexEvents.length,
      topLevelCount: getTopLevelIndexEvents(sessionCache.indexEvents).length,
      indexEvents: sessionCache.indexEvents,
      engagement: sessionCache.engagement
    }
  }

  const indexEvents = await fetchLibraryIndexEvents(relayUrls)
  if (import.meta.env.DEV) {
    logger.info('[Library] indexes fetched', { validCount: indexEvents.length })
  }

  const indexByAddress = buildIndexByAddress(indexEvents)
  let topLevel = getTopLevelIndexEvents(indexEvents)

  options?.onIndexesReady?.({
    engaged: buildRecentPublicationEntries(topLevel, indexByAddress, emptyPublicationEngagementMaps()),
    allIndexCount: indexEvents.length,
    topLevelCount: topLevel.length,
    indexEvents
  })

  const topLevelForHydrate = topLevel
  await hydrateNestedIndexEvents(indexEvents, indexByAddress, relayUrls, {
    maxPasses: 1,
    maxMissingPerPass: HYDRATE_MISSING_CAP,
    scanRoots: topLevelForHydrate
  })
  if (import.meta.env.DEV) {
    logger.info('[Library] nested hydrate done', { indexCount: indexEvents.length })
  }

  topLevel = getTopLevelIndexEvents(indexEvents)
  const targetAddresses = collectTargetAddressesFromIndexes(indexEvents, indexByAddress)
  const targetEventIds = collectPublicationIndexEventIds(indexEvents)
  if (import.meta.env.DEV) {
    logger.info('[Library] fetching engagement', {
      targetAddresses: targetAddresses.size,
      targetEventIds: targetEventIds.size
    })
  }

  let engagement: PublicationEngagementMaps
  try {
    engagement = await Promise.race([
      fetchPublicationEngagementMaps(relayUrls, targetAddresses, targetEventIds, {
        httpOnly: true,
        viewerPubkey
      }),
      new Promise<PublicationEngagementMaps>((resolve) => {
        window.setTimeout(() => resolve(emptyPublicationEngagementMaps()), ENGAGEMENT_FETCH_TIMEOUT_MS)
      })
    ])
  } catch (e) {
    if (import.meta.env.DEV) {
      logger.warn('[Library] engagement fetch failed', {
        message: e instanceof Error ? e.message : String(e)
      })
    }
    engagement = emptyPublicationEngagementMaps()
  }
  if (import.meta.env.DEV) {
    logger.info('[Library] engagement maps built', {
      labels: engagement.labelAddresses.size + engagement.labelEventIds.size,
      comments: engagement.commentAddresses.size,
      highlights: engagement.highlightAddresses.size
    })
  }

  sessionCache = { relayKey: key, viewerPubkey, indexEvents, indexByAddress, engagement }

  const engaged = pickLibraryPublicationEntries(topLevel, indexByAddress, engagement)

  if (import.meta.env.DEV) {
    logger.info('[Library] load done', {
      engaged: engaged.length,
      topLevel: topLevel.length,
      allIndexCount: indexEvents.length,
      recentFallback: engaged.length > 0 && engaged.every((e) => e.engagementCount === 0)
    })
  }

  return {
    engaged,
    allIndexCount: indexEvents.length,
    topLevelCount: topLevel.length,
    indexEvents,
    engagement
  }
}

export function clearLibraryPublicationIndexCache(): void {
  sessionCache = null
  clearLibrarySearchSessionCache()
}

/** Clears Library tab session + IDB index cache only (publication reading cache is unchanged). */
export async function clearAllLibraryIndexCaches(): Promise<void> {
  sessionCache = null
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
