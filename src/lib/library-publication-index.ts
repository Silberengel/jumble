import { ExtendedKind, LIBRARY_RELAY_URLS } from '@/constants'
import {
  buildIndexByAddress,
  collectReachableAddresses,
  eventTagAddress,
  fetchMissingIndexByAddress,
  filterValidIndexEvents,
  getTopLevelIndexEvents
} from '@/lib/publication-index'
import { buildComprehensiveRelayList } from '@/lib/relay-list-builder'
import { normalizeUrl } from '@/lib/url'
import { queryService } from '@/services/client.service'
import type { Event, Filter } from 'nostr-tools'
import { kinds, nip19 } from 'nostr-tools'

const INDEX_FETCH_LIMIT = 500
const ENGAGEMENT_FETCH_LIMIT = 500

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

export async function buildLibraryRelayUrls(userPubkey?: string): Promise<string[]> {
  const base = LIBRARY_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter(Boolean)
  const urls = await buildComprehensiveRelayList({
    userPubkey,
    includeUserOwnRelays: true,
    includeFastReadRelays: true,
    includeSearchableRelays: true,
    includeFavoriteRelays: true,
    relayHints: base
  })
  return [...new Set([...base, ...urls])]
}

function dedupeEventsById(events: Event[]): Event[] {
  const byId = new Map<string, Event>()
  for (const ev of events) {
    const prev = byId.get(ev.id)
    if (!prev || ev.created_at > prev.created_at) byId.set(ev.id, ev)
  }
  return [...byId.values()]
}

export async function fetchLibraryIndexEvents(relayUrls: string[]): Promise<Event[]> {
  if (relayUrls.length === 0) return []
  const filter: Filter = { kinds: [ExtendedKind.PUBLICATION], limit: INDEX_FETCH_LIMIT }
  const events = await queryService.fetchEvents(relayUrls, [filter], {
    globalTimeout: 25_000,
    eoseTimeout: 4_000,
    firstRelayResultGraceMs: false
  })
  return filterValidIndexEvents(dedupeEventsById(events))
}

export function buildEngagementMapsFromEvents(
  labels: Event[],
  comments: Event[],
  highlights: Event[]
): PublicationEngagementMaps {
  const labelAddresses = new Set<string>()
  const labelEventIds = new Set<string>()
  const commentAddresses = new Set<string>()
  const highlightAddresses = new Set<string>()

  for (const ev of labels) {
    for (const tag of ev.tags) {
      if (tag[0] === 'a' && tag[1]) labelAddresses.add(tag[1])
      if (tag[0] === 'e' && tag[1]) labelEventIds.add(tag[1].toLowerCase())
    }
  }

  for (const ev of comments) {
    for (const tag of ev.tags) {
      if (tag[0] === 'A' && tag[1]) commentAddresses.add(tag[1])
    }
  }

  for (const ev of highlights) {
    for (const tag of ev.tags) {
      if (tag[0] === 'a' && tag[1]) highlightAddresses.add(tag[1])
    }
  }

  return { labelAddresses, labelEventIds, commentAddresses, highlightAddresses }
}

export async function fetchPublicationEngagementMaps(
  relayUrls: string[]
): Promise<PublicationEngagementMaps> {
  if (relayUrls.length === 0) {
    return {
      labelAddresses: new Set(),
      labelEventIds: new Set(),
      commentAddresses: new Set(),
      highlightAddresses: new Set()
    }
  }

  const opts = {
    globalTimeout: 25_000,
    eoseTimeout: 4_000,
    firstRelayResultGraceMs: false as const
  }

  const [labels, comments, highlights] = await Promise.all([
    queryService.fetchEvents(
      relayUrls,
      [{ kinds: [ExtendedKind.LABEL], limit: ENGAGEMENT_FETCH_LIMIT }],
      opts
    ),
    queryService.fetchEvents(
      relayUrls,
      [{ kinds: [ExtendedKind.COMMENT], limit: ENGAGEMENT_FETCH_LIMIT }],
      opts
    ),
    queryService.fetchEvents(
      relayUrls,
      [{ kinds: [kinds.Highlights], limit: ENGAGEMENT_FETCH_LIMIT }],
      opts
    )
  ])

  return buildEngagementMapsFromEvents(
    dedupeEventsById(labels),
    dedupeEventsById(comments),
    dedupeEventsById(highlights)
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

export async function filterEngagedPublications(
  roots: Event[],
  indexByAddress: Map<string, Event>,
  engagement: PublicationEngagementMaps,
  relayUrls: string[]
): Promise<LibraryPublicationEntry[]> {
  const fetchMissing = (address: string) => fetchMissingIndexByAddress(address, relayUrls)
  const out: LibraryPublicationEntry[] = []

  for (const root of roots) {
    const reachable = await collectReachableAddresses(root, indexByAddress, fetchMissing)
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

export async function loadLibraryPublicationIndex(
  relayUrls: string[],
  options?: { forceRefresh?: boolean }
): Promise<{
  engaged: LibraryPublicationEntry[]
  allIndexCount: number
  topLevelCount: number
}> {
  const key = relaySetKey(relayUrls)
  if (!options?.forceRefresh && sessionCache?.relayKey === key) {
    return {
      engaged: sortLibraryPublications(
        await filterEngagedPublications(
          getTopLevelIndexEvents(sessionCache.indexEvents),
          sessionCache.indexByAddress,
          sessionCache.engagement,
          relayUrls
        )
      ),
      allIndexCount: sessionCache.indexEvents.length,
      topLevelCount: getTopLevelIndexEvents(sessionCache.indexEvents).length
    }
  }

  const [indexEvents, engagement] = await Promise.all([
    fetchLibraryIndexEvents(relayUrls),
    fetchPublicationEngagementMaps(relayUrls)
  ])
  const indexByAddress = buildIndexByAddress(indexEvents)
  sessionCache = { relayKey: key, indexEvents, indexByAddress, engagement }

  const topLevel = getTopLevelIndexEvents(indexEvents)
  const engaged = sortLibraryPublications(
    await filterEngagedPublications(topLevel, indexByAddress, engagement, relayUrls)
  )

  return {
    engaged,
    allIndexCount: indexEvents.length,
    topLevelCount: topLevel.length
  }
}

export function clearLibraryPublicationIndexCache(): void {
  sessionCache = null
}
