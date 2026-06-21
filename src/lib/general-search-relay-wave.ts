import { eventMatchesGeneralSearchQuery } from '@/lib/general-search-text-match'
import { mergedSearchNoteHasPreviewBody } from '@/lib/merged-search-note-preview'
import { normalizeUrl } from '@/lib/url'
import client from '@/services/client.service'
import { relayHostForSubscribeLog } from '@/services/relay-operation-log.service'
import type { Event, Filter } from 'nostr-tools'

export const GENERAL_SEARCH_RELAY_CONCURRENCY = 3
export const GENERAL_SEARCH_PER_RELAY_LIMIT = 120
export const GENERAL_SEARCH_MAX_EVENTS_PER_RELAY = 50
export const GENERAL_SEARCH_RELAY_WALL_MS = 45_000
export const GENERAL_SEARCH_AFTER_FIRST_HITS_MS = 8_000
export const GENERAL_SEARCH_PER_RELAY_QUERY_MS = 20_000
/** Overall wall clock for local cache + IndexedDB text search on the search page. */
export const GENERAL_SEARCH_LOCAL_WALL_MS = 20_000

export type GeneralSearchRelayFetchPhase = 'loading' | 'done' | 'error'

export type GeneralSearchRelayFetchRow = {
  relayUrl: string
  host: string
  phase: GeneralSearchRelayFetchPhase
  eventCount?: number
  rawCount?: number
  ms?: number
  errorMessage?: string
}

export function normalizeGeneralSearchRelayList(urls: readonly string[]): string[] {
  return Array.from(
    new Set(urls.map((u) => normalizeUrl(u) || u.trim()).filter((u): u is string => u.length > 0))
  ).sort((a, b) => relayHostForSubscribeLog(a).localeCompare(relayHostForSubscribeLog(b)))
}

export function generalSearchRelayKey(url: string): string {
  return (normalizeUrl(url) || url.trim()).toLowerCase()
}

/** Kind-only relay REQ, then client match on title / summary / content (no NIP-50 `search`). */
export function filterRelayBatchForGeneralSearch(
  events: readonly Event[],
  query: string,
  allowedKinds: readonly number[]
): Event[] {
  const q = query.trim()
  if (!q) return []
  const kindSet = new Set(allowedKinds)
  const out: Event[] = []
  for (const ev of events) {
    if (!kindSet.has(ev.kind)) continue
    if (!eventMatchesGeneralSearchQuery(ev, q)) continue
    if (!mergedSearchNoteHasPreviewBody(ev)) continue
    out.push(ev)
  }
  return out
}

export async function fetchGeneralSearchEventsFromRelay(
  relayUrl: string,
  query: string,
  kinds: readonly number[],
  options: { globalTimeout: number; signal?: AbortSignal }
): Promise<{ events: Event[]; rawCount: number; connectionError?: string }> {
  const filter: Filter = {
    kinds: [...kinds],
    limit: GENERAL_SEARCH_PER_RELAY_LIMIT
  }
  const { events: raw, connectionError } = await client.fetchEventsFromSingleRelay(relayUrl, filter, {
    globalTimeout: options.globalTimeout,
    signal: options.signal,
    relayOpSource: 'generalSearchRelayWave'
  })
  const matched = filterRelayBatchForGeneralSearch(raw, query, kinds).slice(
    0,
    GENERAL_SEARCH_MAX_EVENTS_PER_RELAY
  )
  return { events: matched, rawCount: raw.length, connectionError }
}
