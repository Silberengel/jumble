import { ExtendedKind, NOSTR_ARCHIVES_SEARCH_RELAY_URL } from '@/constants'
import { isMetadataRelaysOnlyPolicyActive } from '@/lib/read-only-relay-personal'
import { normalizeAnyRelayUrl, normalizeUrl } from '@/lib/url'

/**
 * Trending notes stream from nostrarchives (path-based relay URL). The WebSocket speaks **standard NIP-01**
 * `REQ` / `EVENT` / `EOSE` — safe for nostr-tools {@link SimplePool}. Same URL shape as Wisp’s
 * {@link https://github.com/barrydeen/wisp | Wisp} (Android) `buildTrendingRelayUrl` / `FEED_KINDS` REQ.
 */
export type WispTrendingMetric = 'reactions' | 'replies' | 'reposts' | 'zaps'

export type WispTrendingTimeframe = 'today' | '7d' | '30d' | '1y' | 'all'

export function buildWispTrendingNotesRelayUrl(
  metric: WispTrendingMetric = 'reactions',
  timeframe: WispTrendingTimeframe = 'today'
): string {
  return `wss://feeds.nostrarchives.com/notes/trending/${metric}/${timeframe}`
}

/** Wisp `FeedSubscriptionManager` FEED_KINDS when subscribing to trending notes. */
export const WISP_TRENDING_FEED_KINDS: readonly number[] = [
  1,
  6,
  1068,
  30023,
  ExtendedKind.PICTURE,
  ExtendedKind.VIDEO,
  ExtendedKind.SHORT_VIDEO,
  ExtendedKind.VIDEO_ADDRESSABLE
]

/**
 * Ensure the default nostrarchives trending notes relay is present in a favorite-relay list.
 * Skips when any Wisp trending URL is already listed (dedupes duplicate trending paths).
 * When `forFeed` is true, omits injection under the metadata-relays-only read policy.
 */
export function ensureTrendingInFavoriteRelayList(
  relayUrls: readonly string[],
  options?: { forFeed?: boolean }
): string[] {
  if (options?.forFeed && isMetadataRelaysOnlyPolicyActive()) {
    return [...relayUrls]
  }

  const out: string[] = []
  const seen = new Set<string>()
  let hasTrending = false

  for (const raw of relayUrls) {
    const normalized = normalizeAnyRelayUrl(raw) || raw.trim()
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    if (isWispTrendingNotesRelayUrl(normalized)) {
      if (hasTrending) continue
      hasTrending = true
    }
    seen.add(key)
    out.push(normalized)
  }

  if (!hasTrending) {
    const trending = normalizeUrl(buildWispTrendingNotesRelayUrl()) || buildWispTrendingNotesRelayUrl()
    const key = trending.toLowerCase()
    if (!seen.has(key)) {
      out.push(trending)
    }
  }

  return out
}

/** True when `url` is the nostrarchives NIP-50 search relay (WebSocket only — no HTTP NIP-11 document). */
export function isNostrArchivesSearchRelayUrl(url: string): boolean {
  const norm = (normalizeUrl(url) || url).trim().toLowerCase()
  const search = (normalizeUrl(NOSTR_ARCHIVES_SEARCH_RELAY_URL) || NOSTR_ARCHIVES_SEARCH_RELAY_URL).toLowerCase()
  return norm === search || norm.startsWith(`${search}/`)
}

/** True when `url` is any nostrarchives notes trending WebSocket feed (path `/notes/trending/...`). */
export function isWispTrendingNotesRelayUrl(url: string): boolean {
  const raw = (normalizeUrl(url) || url).trim()
  const forParse = raw.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://')
  try {
    const u = new URL(forParse)
    return (
      u.hostname.toLowerCase() === 'feeds.nostrarchives.com' &&
      u.pathname.toLowerCase().startsWith('/notes/trending/')
    )
  } catch {
    return false
  }
}
