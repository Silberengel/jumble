import { ExtendedKind, LIBRARY_RELAY_URLS } from '@/constants'
import logger from '@/lib/logger'
import { queryIndexRelay } from '@/lib/index-relay-http'
import {
  buildIndexByAddress,
  collectPublicationIndexEventIds,
  collectReachableAddressesCached,
  eventTagAddress,
  filterValidIndexEvents,
  getTopLevelIndexEvents,
  hydrateNestedIndexEvents
} from '@/lib/publication-index'
import { buildComprehensiveRelayList } from '@/lib/relay-list-builder'
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
const QUERY_OPTS = {
  globalTimeout: 18_000,
  eoseTimeout: 3_000,
  firstRelayResultGraceMs: false as const
}

export type PublicationEngagementMaps = {
  labelAddresses: Set<string>
  labelEventIds: Set<string>
  commentAddresses: Set<string>
  highlightAddresses: Set<string>
}

export type LibraryPublicationEntry = {
  event: Event
  hasLabel: boolean
  hasComment: boolean
  hasHighlight: boolean
  engagementCount: number
}

type LibraryIndexCache = {
  relayKey: string
  indexEvents: Event[]
  indexByAddress: Map<string, Event>
  engagement: PublicationEngagementMaps
}

let sessionCache: LibraryIndexCache | null = null

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
    const batch = await queryIndexRelay(baseUrl, pageFilter)
    if (batch.length === 0) break

    let oldest = batch[0].created_at
    for (const ev of batch) {
      if (ev.created_at < oldest) oldest = ev.created_at
      if (seen.has(ev.id)) continue
      seen.add(ev.id)
      out.push(ev)
    }

    if (batch.length < INDEX_HTTP_PAGE_LIMIT) break
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
  const filter: Filter = { kinds: [ExtendedKind.PUBLICATION], limit: INDEX_FETCH_LIMIT }
  const { wsRelays, httpRelays } = splitWsAndHttpRelays(indexRelays)

  const batches: Promise<Event[]>[] = []
  if (wsRelays.length > 0) {
    batches.push(queryService.fetchEvents(wsRelays, [filter], QUERY_OPTS))
  }
  for (const httpRelay of httpRelays) {
    batches.push(fetchPaginatedFromHttpIndexRelay(httpRelay, filter))
  }

  const merged = dedupeEventsById((await Promise.all(batches)).flat())
  const valid = filterValidIndexEvents(merged)
  if (import.meta.env.DEV) {
    logger.info('[Library] index fetch', {
      indexRelays: indexRelays.length,
      wsRelays: wsRelays.length,
      httpRelays: httpRelays.length,
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
  targetEventIds?: Set<string>
): PublicationEngagementMaps {
  const labelAddresses = new Set<string>()
  const labelEventIds = new Set<string>()
  const commentAddresses = new Set<string>()
  const highlightAddresses = new Set<string>()

  const addressMatches = (addr: string) => !targetAddresses || targetAddresses.has(addr)
  const eventIdMatches = (id: string) => !targetEventIds || targetEventIds.has(id.toLowerCase())

  for (const ev of labels) {
    for (const tag of ev.tags) {
      if (tag[0] === 'a' && tag[1] && addressMatches(tag[1])) labelAddresses.add(tag[1])
      if (tag[0] === 'e' && tag[1] && eventIdMatches(tag[1])) labelEventIds.add(tag[1].toLowerCase())
    }
  }

  for (const ev of comments) {
    for (const tag of ev.tags) {
      if (tag[0] === 'A' && tag[1] && addressMatches(tag[1])) commentAddresses.add(tag[1])
    }
  }

  for (const ev of highlights) {
    for (const tag of ev.tags) {
      if (tag[0] === 'a' && tag[1] && addressMatches(tag[1])) highlightAddresses.add(tag[1])
    }
  }

  return { labelAddresses, labelEventIds, commentAddresses, highlightAddresses }
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
  targetEventIds: Set<string>
): Promise<PublicationEngagementMaps> {
  if (relayUrls.length === 0 || targetAddresses.size === 0) {
    return {
      labelAddresses: new Set(),
      labelEventIds: new Set(),
      commentAddresses: new Set(),
      highlightAddresses: new Set()
    }
  }

  const addressChunks = chunkArray([...targetAddresses], ENGAGEMENT_ADDRESS_CHUNK)
  const eventIdChunks = chunkArray([...targetEventIds], ENGAGEMENT_EVENT_ID_CHUNK)
  const { wsRelays, httpRelays } = splitWsAndHttpRelays(relayUrls)

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
    wsRelays.length > 0 && highlightFilters.length > 0
      ? queryService.fetchEvents(wsRelays, highlightFilters, QUERY_OPTS)
      : Promise.resolve([] as Event[]),
    fetchHttpEngagementByAddresses(httpRelays, kinds.Highlights, '#a', addressChunks)
  ]).then(([scoped, bulk]) => dedupeEventsById([...scoped, ...bulk]))

  const labelPromise = Promise.all([
    wsRelays.length > 0 && labelAddressFilters.length > 0
      ? queryService.fetchEvents(wsRelays, labelAddressFilters, QUERY_OPTS)
      : Promise.resolve([] as Event[]),
    wsRelays.length > 0 && labelEventFilters.length > 0
      ? queryService.fetchEvents(wsRelays, labelEventFilters, QUERY_OPTS)
      : Promise.resolve([] as Event[]),
    fetchHttpEngagementByAddresses(httpRelays, ExtendedKind.LABEL, '#a', addressChunks)
  ]).then(([byAddress, byEvent, bulk]) => dedupeEventsById([...byAddress, ...byEvent, ...bulk]))

  const commentPromise = Promise.all([
    wsRelays.length > 0 && commentWsFilters.length > 0
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
    targetEventIds
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

export function filterEngagedPublications(
  roots: Event[],
  indexByAddress: Map<string, Event>,
  engagement: PublicationEngagementMaps
): LibraryPublicationEntry[] {
  const out: LibraryPublicationEntry[] = []

  for (const root of roots) {
    const reachable = collectReachableAddressesCached(root, indexByAddress)
    const rootAddr = eventTagAddress(root)
    if (rootAddr) reachable.add(rootAddr)

    let hasLabel = false
    let hasComment = false
    let hasHighlight = false
    let engagementCount = 0

    for (const addr of reachable) {
      const indexed = indexByAddress.get(addr)
      const flags = addressHasEngagement(addr, indexed?.id, engagement)
      if (flags.hasLabel) hasLabel = true
      if (flags.hasComment) hasComment = true
      if (flags.hasHighlight) hasHighlight = true
      if (flags.hasLabel || flags.hasComment || flags.hasHighlight) engagementCount++
    }

    const rootFlags = addressHasEngagement(rootAddr ?? '', root.id, engagement)
    hasLabel = hasLabel || rootFlags.hasLabel
    hasComment = hasComment || rootFlags.hasComment
    hasHighlight = hasHighlight || rootFlags.hasHighlight

    if (hasLabel || hasComment || hasHighlight) {
      out.push({
        event: root,
        hasLabel,
        hasComment,
        hasHighlight,
        engagementCount: Math.max(engagementCount, 1)
      })
    }
  }

  return out
}

export function sortLibraryPublications(entries: LibraryPublicationEntry[]): LibraryPublicationEntry[] {
  return [...entries].sort((a, b) => {
    if (a.hasLabel !== b.hasLabel) return a.hasLabel ? -1 : 1
    if (a.engagementCount !== b.engagementCount) return b.engagementCount - a.engagementCount
    return b.event.created_at - a.event.created_at
  })
}

function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase()
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

export function filterLibraryPublicationsBySearch(
  entries: LibraryPublicationEntry[],
  query: string
): LibraryPublicationEntry[] {
  const q = normalizeSearchQuery(query)
  if (!q) return entries

  const npub = tryNpubFromQuery(q)
  if (npub) {
    return entries.filter(({ event }) => event.pubkey.toLowerCase() === npub)
  }

  return entries.filter(({ event }) => {
    const title = event.tags.find((t) => t[0] === 'title')?.[1]?.toLowerCase() ?? ''
    const author = event.tags.find((t) => t[0] === 'author')?.[1]?.toLowerCase() ?? ''
    const nip05 = event.tags.find((t) => t[0] === 'nip05')?.[1]?.toLowerCase() ?? ''
    const dTag = event.tags.find((t) => t[0] === 'd')?.[1]?.toLowerCase() ?? ''
    const pubkey = event.pubkey.toLowerCase()
    return (
      title.includes(q) ||
      author.includes(q) ||
      nip05.includes(q) ||
      dTag.includes(q) ||
      pubkey.includes(q)
    )
  })
}

export function filterLibraryPublicationsByUser(
  entries: LibraryPublicationEntry[],
  userPubkey: string | null | undefined
): LibraryPublicationEntry[] {
  if (!userPubkey) return entries
  const pk = userPubkey.toLowerCase()
  return entries.filter(({ event }) => {
    if (event.pubkey.toLowerCase() === pk) return true
    return event.tags.some((t) => t[0] === 'p' && t[1]?.toLowerCase() === pk)
  })
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
  return sortLibraryPublications(filterEngagedPublications(topLevel, indexByAddress, maps))
}

export async function loadLibraryPublicationIndex(
  relayUrls: string[],
  options?: { forceRefresh?: boolean }
): Promise<{
  engaged: LibraryPublicationEntry[]
  allIndexCount: number
  topLevelCount: number
}> {
  const key = relaySetKey(relayUrls)
  if (import.meta.env.DEV) {
    logger.info('[Library] load start', { relayCount: relayUrls.length, cached: sessionCache?.relayKey === key })
  }

  if (!options?.forceRefresh && sessionCache?.relayKey === key) {
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
      topLevelCount: getTopLevelIndexEvents(sessionCache.indexEvents).length
    }
  }

  const indexEvents = await fetchLibraryIndexEvents(relayUrls)
  if (import.meta.env.DEV) {
    logger.info('[Library] indexes fetched', { validCount: indexEvents.length })
  }

  const indexByAddress = buildIndexByAddress(indexEvents)
  const topLevelForHydrate = getTopLevelIndexEvents(indexEvents)
  await hydrateNestedIndexEvents(indexEvents, indexByAddress, relayUrls, {
    maxPasses: 1,
    maxMissingPerPass: HYDRATE_MISSING_CAP,
    scanRoots: topLevelForHydrate
  })
  if (import.meta.env.DEV) {
    logger.info('[Library] nested hydrate done', { indexCount: indexEvents.length })
  }

  const targetAddresses = collectTargetAddressesFromIndexes(indexEvents, indexByAddress)
  const targetEventIds = collectPublicationIndexEventIds(indexEvents)
  if (import.meta.env.DEV) {
    logger.info('[Library] fetching engagement', {
      targetAddresses: targetAddresses.size,
      targetEventIds: targetEventIds.size
    })
  }
  const engagement = await fetchPublicationEngagementMaps(
    relayUrls,
    targetAddresses,
    targetEventIds
  )
  if (import.meta.env.DEV) {
    logger.info('[Library] engagement maps built', {
      labels: engagement.labelAddresses.size + engagement.labelEventIds.size,
      comments: engagement.commentAddresses.size,
      highlights: engagement.highlightAddresses.size
    })
  }

  sessionCache = { relayKey: key, indexEvents, indexByAddress, engagement }

  const topLevel = getTopLevelIndexEvents(indexEvents)
  const engaged = sortLibraryPublications(filterEngagedPublications(topLevel, indexByAddress, engagement))

  if (import.meta.env.DEV) {
    logger.info('[Library] load done', {
      engaged: engaged.length,
      topLevel: topLevel.length,
      allIndexCount: indexEvents.length
    })
  }

  return {
    engaged,
    allIndexCount: indexEvents.length,
    topLevelCount: topLevel.length
  }
}

export function clearLibraryPublicationIndexCache(): void {
  sessionCache = null
}
