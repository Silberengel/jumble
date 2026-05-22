import { SEARCHABLE_RELAY_URLS } from '@/constants'
import { AGGR_NOSTR_LAND_WSS } from '@/lib/nostr-land-aggr'
import { normalizeAnyRelayUrl } from '@/lib/url'

/**
 * True when the URL is `wss://aggr.nostr.land` (aggregator read/search endpoint).
 */
export function relayUrlIsAggrNostrLand(url: string): boolean {
  const raw = url.trim()
  if (!raw) return false
  const normalized = (normalizeAnyRelayUrl(raw) || raw).toLowerCase()
  const aggrCanon = (normalizeAnyRelayUrl(AGGR_NOSTR_LAND_WSS) || AGGR_NOSTR_LAND_WSS).toLowerCase()
  if (normalized === aggrCanon) return true
  try {
    const u = new URL(normalized.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://'))
    return u.hostname.toLowerCase() === 'aggr.nostr.land'
  } catch {
    return /^wss:\/\/aggr\.nostr\.land\/?$/i.test(normalized)
  }
}

/**
 * True when any URL is the canonical nostr.land **inbox** relay (`wss://nostr.land`), i.e. host `nostr.land`
 * exactly — not `aggr.nostr.land`, `hist.nostr.land`, or other subdomains.
 */
export function relayUrlsIncludeCanonicalNostrLandRelay(urls: readonly string[]): boolean {
  return urls.some((url) => {
    const normalized = normalizeAnyRelayUrl(url) || String(url).trim()
    if (!normalized) return false
    try {
      const parsed = new URL(
        normalized.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://')
      )
      return parsed.hostname.toLowerCase() === 'nostr.land'
    } catch {
      return false
    }
  })
}

/** @deprecated Use {@link relayUrlsIncludeCanonicalNostrLandRelay}. */
export function relayUrlsMentionNostrLandDomain(urls: readonly string[]): boolean {
  return relayUrlsIncludeCanonicalNostrLandRelay(urls)
}

let viewerStackMentionsNostrLand = false

/**
 * Synced from the logged-in viewer’s favorites and NIP-65 / cache / HTTP relay lists.
 * When true, {@link AGGR_NOSTR_LAND_WSS} is treated as a search relay and inbox-tier read relay.
 */
export function syncViewerRelayStackNostrLandAggrEligible(urls: readonly string[]): boolean {
  viewerStackMentionsNostrLand = relayUrlsIncludeCanonicalNostrLandRelay(urls)
  return viewerStackMentionsNostrLand
}

export function getViewerRelayStackNostrLandAggrEligible(): boolean {
  return viewerStackMentionsNostrLand
}

/** Aggr URL to merge into NIP-50 / searchable relay sets when the viewer lists `wss://nostr.land`. */
export function getViewerNostrLandAggrSearchRelayUrls(): string[] {
  if (!viewerStackMentionsNostrLand) return []
  const n = normalizeAnyRelayUrl(AGGR_NOSTR_LAND_WSS) || AGGR_NOSTR_LAND_WSS
  return n ? [n] : []
}

/**
 * Search / wide-id fetch relays: aggr first when eligible, then {@link SEARCHABLE_RELAY_URLS}.
 * Use for reply-to blurbs, thread parent/root fallback, embed wide pass, etc. — not home timeline OP REQs.
 */
export function getAggrAwareSearchRelayUrls(): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (raw: string) => {
    const n = normalizeAnyRelayUrl(raw) || raw.trim()
    if (!n) return
    const k = n.toLowerCase()
    if (seen.has(k)) return
    seen.add(k)
    out.push(n)
  }
  for (const u of getViewerNostrLandAggrSearchRelayUrls()) add(u)
  for (const u of SEARCHABLE_RELAY_URLS) add(u)
  return out
}

/** Drop aggr unless the viewer has `wss://nostr.land` on favorites or relay lists. */
export function filterAggrNostrLandUnlessViewerEligible(urls: readonly string[]): string[] {
  if (viewerStackMentionsNostrLand) return [...urls]
  return urls.filter((u) => !relayUrlIsAggrNostrLand(u))
}

/** URLs to pass to {@link syncViewerRelayStackNostrLandAggrEligible} (favorites + NIP-65 + cache + HTTP lists). */
export function urlsForViewerNostrLandAggrEligibilitySync(options: {
  favoriteRelayUrls?: readonly string[]
  relayListRead?: readonly string[]
  relayListWrite?: readonly string[]
  cacheRelayRead?: readonly string[]
  httpRelayRead?: readonly string[]
}): string[] {
  return [
    ...(options.favoriteRelayUrls ?? []),
    ...(options.relayListRead ?? []),
    ...(options.relayListWrite ?? []),
    ...(options.cacheRelayRead ?? []),
    ...(options.httpRelayRead ?? [])
  ]
}

/**
 * Prepend aggr for event-by-id lookups (threads, embeds, parent previews, comprehensive fetch).
 * Home OP timelines must not use this — use {@link buildAllFavoritesFeedRelayUrls} / `nostrLandAggr: 'never'`.
 */
export function prependAggrForEventLookupRelayUrls(relayUrls: readonly string[]): string[] {
  return prependAggrNostrLandIfViewerEligible(relayUrls)
}

/** Deduped prepend of aggr when the viewer opted into nostr.land relays (see sync…). */
export function prependAggrNostrLandIfViewerEligible(relayUrls: readonly string[]): string[] {
  if (!viewerStackMentionsNostrLand) return [...relayUrls]
  const aggrNorm = (normalizeAnyRelayUrl(AGGR_NOSTR_LAND_WSS) || AGGR_NOSTR_LAND_WSS).toLowerCase()
  const norm = (u: string) => (normalizeAnyRelayUrl(u) || u.trim()).toLowerCase()
  if (relayUrls.some((u) => norm(u) === aggrNorm)) {
    return [...relayUrls]
  }
  return [AGGR_NOSTR_LAND_WSS, ...relayUrls]
}
