import type { TFeedSubRequest } from '@/types'
import { normalizeUrl } from '@/lib/url'
import type { Event, Filter } from 'nostr-tools'
import { tagNameEquals } from '@/lib/tag'

/** Canonical JSON for a REQ filter so subscription identity ignores object identity / key order. */
export function stableSpellFeedFilterKey(filter: Filter): string {
  const entries = Object.entries(filter)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify(Object.fromEntries(entries))
}

/** Normalize filter from spell keys (string) or {@link legacyFeedSubscriptionKey} payloads (object). */
function feedRequestFilterIdentityKey(filter: unknown): string {
  if (typeof filter === 'string') return filter
  if (filter && typeof filter === 'object') {
    return stableSpellFeedFilterKey(filter as Filter)
  }
  return String(filter)
}

/**
 * Single string identity for spell / faux-spell `subRequests`.
 * Pass from SpellsPage into NoteList as `feedSubscriptionKey` so timeline subscription does not
 * restart when parent passes a new `subRequests` array reference with identical REQ shape.
 */
export function computeSpellSubRequestsIdentityKey(subRequests: TFeedSubRequest[]): string {
  if (!subRequests.length) return ''
  return JSON.stringify(
    subRequests.map((req) => ({
      urls: [...req.urls].map((u) => normalizeUrl(u) || u).filter(Boolean).sort(),
      filter: stableSpellFeedFilterKey(req.filter)
    }))
  )
}

/**
 * Kind-777 spell feed key: use raw `since` / `until` tag strings plus filters **without** resolved unix
 * timestamps. Resolved times change on every memo recompute (`resolveRelativeTime` uses `Date.now()`),
 * which was restarting NoteList subscriptions every tick → endless loading.
 */
export function computeKind777SpellFeedSubscriptionKey(spell: Event, subRequests: TFeedSubRequest[]): string {
  const sinceRaw = spell.tags.find(tagNameEquals('since'))?.[1] ?? ''
  const untilRaw = spell.tags.find(tagNameEquals('until'))?.[1] ?? ''
  const sansTime = subRequests.map((req) => {
    const { since: _s, until: _u, ...rest } = req.filter as Filter & { since?: number; until?: number }
    return {
      urls: [...req.urls].map((u) => normalizeUrl(u) || u).filter(Boolean).sort(),
      filter: stableSpellFeedFilterKey(rest as Filter)
    }
  })
  return `${spell.id}|sinceRaw:${sinceRaw}|untilRaw:${untilRaw}|${JSON.stringify(sansTime)}`
}

/**
 * True when `nextKey` is the same REQ filters as `prevKey` but with a strict superset of relay URLs
 * in at least one request slot (e.g. Explore relay reviews: bootstrap relays → full list).
 */
export function isRelayUrlStrictSupersetIdentityKey(prevKey: string | null, nextKey: string): boolean {
  if (!prevKey || prevKey === nextKey) return false
  try {
    type Item = { urls: string[]; filter: unknown }
    const prev = JSON.parse(prevKey) as Item[]
    const next = JSON.parse(nextKey) as Item[]
    if (!Array.isArray(prev) || !Array.isArray(next) || prev.length !== next.length) return false
    let sawStrictGrowth = false
    for (let i = 0; i < prev.length; i++) {
      if (feedRequestFilterIdentityKey(prev[i].filter) !== feedRequestFilterIdentityKey(next[i].filter)) {
        return false
      }
      const ps = new Set(prev[i].urls)
      const ns = new Set(next[i].urls)
      for (const u of ps) {
        if (!ns.has(u)) return false
      }
      if (ns.size > ps.size) sawStrictGrowth = true
    }
    return sawStrictGrowth
  } catch {
    return false
  }
}

/**
 * True when parsed {@link computeSpellSubRequestsIdentityKey} payloads match per-slot REQ `filter` strings
 * but relay URL lists may differ (reorder, NIP-65 refinement, different cap slices).
 * Use with {@link preserveTimelineOnSubRequestsChange} so a provisional relay stack can hand off to a refined
 * stack without clearing rows or flashing the loading state.
 */
export function isSpellSubRequestsSameFiltersDifferentRelays(
  prevKey: string | null,
  nextKey: string
): boolean {
  if (!prevKey || prevKey === nextKey) return false
  try {
    type Item = { urls: string[]; filter: unknown }
    const prev = JSON.parse(prevKey) as Item[]
    const next = JSON.parse(nextKey) as Item[]
    if (!Array.isArray(prev) || !Array.isArray(next) || prev.length !== next.length) return false
    for (let i = 0; i < prev.length; i++) {
      if (feedRequestFilterIdentityKey(prev[i].filter) !== feedRequestFilterIdentityKey(next[i].filter)) {
        return false
      }
    }
    return true
  } catch {
    return false
  }
}

/**
 * True when `nextKey` keeps every prior REQ filter and adds more shards (e.g. notifications spell gains
 * `#e` / `#a` subrequests after thread-watch lists load from relays).
 */
export function isSpellSubRequestsFilterSuperset(prevKey: string | null, nextKey: string): boolean {
  if (!prevKey || prevKey === nextKey) return false
  try {
    type Item = { urls: string[]; filter: unknown }
    const prev = JSON.parse(prevKey) as Item[]
    const next = JSON.parse(nextKey) as Item[]
    if (!Array.isArray(prev) || !Array.isArray(next) || next.length < prev.length) return false
    const nextFilters = new Set(next.map((item) => feedRequestFilterIdentityKey(item.filter)))
    return prev.every((item) => nextFilters.has(feedRequestFilterIdentityKey(item.filter)))
  } catch {
    return false
  }
}
