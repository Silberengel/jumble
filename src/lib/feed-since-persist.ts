import type { TFeedSubRequest } from '@/types'
import type { Event, Filter } from 'nostr-tools'

const STORAGE_KEY = 'jumble:feedSinceByScope'
/** Overlap so clock skew / late-indexed events are not missed on the next REQ. */
const SINCE_OVERLAP_SEC = 120
const MAX_SCOPES = 64

type ScopeMap = Record<string, number>

function readScopeMap(): ScopeMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: ScopeMap = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k === 'string' && typeof v === 'number' && Number.isFinite(v) && v > 0) {
        out[k] = Math.floor(v)
      }
    }
    return out
  } catch {
    return {}
  }
}

function writeScopeMap(map: ScopeMap): void {
  try {
    const keys = Object.keys(map)
    if (keys.length === 0) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    let trimmed = map
    if (keys.length > MAX_SCOPES) {
      const sorted = keys.sort((a, b) => (map[b] ?? 0) - (map[a] ?? 0))
      trimmed = Object.fromEntries(sorted.slice(0, MAX_SCOPES).map((k) => [k, map[k]!]))
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    /* quota / private browsing */
  }
}

export function getPersistedFeedSince(scopeKey: string | undefined): number | undefined {
  if (!scopeKey) return undefined
  return readScopeMap()[scopeKey]
}

/** Persist newest event timestamp for a feed scope (Wisp-style live-sync cursor). */
export function persistFeedSince(scopeKey: string | undefined, events: readonly Event[]): void {
  if (!scopeKey || events.length === 0) return
  let newest = 0
  for (const ev of events) {
    if (ev.created_at > newest) newest = ev.created_at
  }
  if (newest <= 0) return
  const map = readScopeMap()
  const prev = map[scopeKey] ?? 0
  if (newest <= prev) return
  map[scopeKey] = newest
  writeScopeMap(map)
}

export type ApplyPersistedFeedSinceOptions = {
  scopeKey?: string
  /** Skip when user pulled refresh or feed should not narrow live REQs. */
  skip?: boolean
}

/**
 * Add `since` to timeline sub-requests when a persisted cursor exists.
 * Skips shards that already specify `since` / `until`.
 */
export function applyPersistedFeedSinceToSubRequests(
  requests: readonly TFeedSubRequest[],
  options: ApplyPersistedFeedSinceOptions
): TFeedSubRequest[] {
  const { scopeKey, skip } = options
  if (skip || !scopeKey) return [...requests]
  const persisted = getPersistedFeedSince(scopeKey)
  if (persisted == null) return [...requests]
  const since = Math.max(0, persisted - SINCE_OVERLAP_SEC)
  return requests.map(({ urls, filter }) => {
    const f = filter as Filter
    if (typeof f.since === 'number' || typeof f.until === 'number') {
      return { urls, filter }
    }
    return { urls, filter: { ...filter, since } as typeof filter }
  })
}

export function resetPersistedFeedSinceForTests(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
