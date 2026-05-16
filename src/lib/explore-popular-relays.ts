import { DEFAULT_FAVORITE_RELAYS, FAST_READ_RELAY_URLS } from '@/constants'
import { urlIsNonLocalForRemoteViewer } from '@/lib/relay-list-sanitize'
import { normalizeAnyRelayUrl } from '@/lib/url'
import type { ViewerRelayListLike } from '@/lib/viewer-relay-defaults'

/** Public Explore UI: no loopback/LAN and no plain `ws://` (local dev / cache relays). */
export function isExploreBrowsableRelayUrl(raw: string): boolean {
  if (!urlIsNonLocalForRemoteViewer(raw)) return false
  const n = (normalizeAnyRelayUrl(raw) || raw.trim()).toLowerCase()
  return !n.startsWith('ws://')
}

export type BuildExplorePopularRelayUrlsOptions = {
  relayList: ViewerRelayListLike
  favoriteRelays: readonly string[]
  blockedRelays: readonly string[]
  /** Cached NIP-66 lively list from IndexedDB (no network required). */
  nip66CachedUrls?: readonly string[]
  max?: number
}

/**
 * Relay URLs for Explore: merge the viewer's lists + small defaults, rank by how often each URL
 * appears across sources (proxy for "popular in your stack").
 */
export function buildExplorePopularRelayUrls(options: BuildExplorePopularRelayUrlsOptions): string[] {
  const blocked = new Set(
    options.blockedRelays.map((b) => normalizeAnyRelayUrl(b) || b.trim()).filter(Boolean)
  )
  const counts = new Map<string, number>()

  const bump = (raw: string) => {
    if (!isExploreBrowsableRelayUrl(raw)) return
    const k = normalizeAnyRelayUrl(raw) || raw.trim()
    if (!k || blocked.has(k)) return
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }

  const rl = options.relayList
  for (const u of [...(rl?.read ?? []), ...(rl?.write ?? []), ...(rl?.httpRead ?? [])]) {
    bump(u)
  }
  for (const u of options.favoriteRelays) bump(u)
  for (const u of DEFAULT_FAVORITE_RELAYS) bump(u)
  for (const u of FAST_READ_RELAY_URLS) bump(u)
  for (const u of options.nip66CachedUrls ?? []) bump(u)

  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([url]) => url)

  const max = options.max ?? 48
  return ranked.slice(0, max)
}
