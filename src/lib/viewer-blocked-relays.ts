import type { Event } from 'nostr-tools'
import { isRelayBlockedByUser } from '@/lib/relay-blocked'
import { normalizeAnyRelayUrl } from '@/lib/url'

let viewerBlockedRelayUrls: readonly string[] = []

/** Kind 10006 `relay` tags → normalized URLs (deduped). */
export function parseBlockedRelayUrlsFromEvent(event: Event | null | undefined): string[] {
  const out: string[] = []
  if (!event) return out
  event.tags.forEach(([tagName, tagValue]) => {
    if (tagName !== 'relay' || !tagValue) return
    const n = normalizeAnyRelayUrl(tagValue)
    if (n && !out.includes(n)) out.push(n)
  })
  return out
}

/** Updated from IDB hydration and {@link FavoriteRelaysProvider} when the block list changes. */
export function setViewerBlockedRelayUrls(urls: readonly string[]): void {
  viewerBlockedRelayUrls = urls.length ? [...urls] : []
}

export function getViewerBlockedRelayUrls(): readonly string[] {
  return viewerBlockedRelayUrls
}

export function isViewerRelayBlocked(url: string): boolean {
  return isRelayBlockedByUser(url, viewerBlockedRelayUrls)
}

/** Drop user-blocked relays (hostname-aware) before any REQ / query / WebSocket connect. */
export function filterViewerBlockedRelaysForFetch(urls: readonly string[]): string[] {
  if (!viewerBlockedRelayUrls.length) return [...urls]
  return urls.filter((u) => !isRelayBlockedByUser(u, viewerBlockedRelayUrls))
}
