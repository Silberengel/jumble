import { AGGR_NOSTR_LAND_WSS } from '@/lib/nostr-land-aggr'
import { normalizeAnyRelayUrl } from '@/lib/url'

/**
 * True when any URL’s host is `nostr.land` (e.g. `wss://nostr.land`, `wss://aggr.nostr.land`).
 * Used to decide whether read fetches should prepend {@link AGGR_NOSTR_LAND_WSS} (home OP / Replies / Gallery
   * never prepend aggr via {@link FeedProvider}; side-panel threads, profiles, spells, and other reads still use it).
 */
export function relayUrlsMentionNostrLandDomain(urls: readonly string[]): boolean {
  return urls.some((url) => {
    const normalized = normalizeAnyRelayUrl(url) || String(url).trim()
    if (!normalized) return false
    try {
      const parsed = new URL(normalized.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://'))
      return parsed.hostname.toLowerCase() === 'nostr.land'
    } catch {
      return false
    }
  })
}

let viewerStackMentionsNostrLand = false

/**
 * Synced from the logged-in viewer’s relay stack (favorites, relay sets, NIP-65, cache, HTTP lists).
 * Service-layer reads use {@link getViewerRelayStackNostrLandAggrEligible} when building REQ targets.
 */
export function syncViewerRelayStackNostrLandAggrEligible(urls: readonly string[]): boolean {
  viewerStackMentionsNostrLand = relayUrlsMentionNostrLandDomain(urls)
  return viewerStackMentionsNostrLand
}

export function getViewerRelayStackNostrLandAggrEligible(): boolean {
  return viewerStackMentionsNostrLand
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
