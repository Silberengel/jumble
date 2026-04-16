import { isHttpRelayUrl, isLocalNetworkUrl, normalizeAnyRelayUrl, normalizeUrl } from '@/lib/url'
import type { TRelayList } from '@/types'

/**
 * Remove LAN / loopback relay URLs (e.g. ws://localhost:4869, 192.168.x.x).
 * Apply to **kind 10002** (NIP-65): those URLs belong on kind 10432 (cache relays), not read/write outbox/inbox.
 * Still use when merging **another user's** 10002 so we never open their LAN relays.
 */
export function stripLocalNetworkRelaysFromRelayList(list: TRelayList): TRelayList {
  const keepUrl = (u: string): boolean => {
    const n = isHttpRelayUrl(u) ? normalizeAnyRelayUrl(u) || u : normalizeUrl(u) || u
    return Boolean(n && !isLocalNetworkUrl(isHttpRelayUrl(u) ? u : n))
  }
  return {
    write: list.write.filter(keepUrl),
    read: list.read.filter(keepUrl),
    originalRelays: list.originalRelays.filter((r) => keepUrl(r.url)),
    httpWrite: (list.httpWrite ?? []).filter(keepUrl),
    httpRead: (list.httpRead ?? []).filter(keepUrl),
    httpOriginalRelays: (list.httpOriginalRelays ?? []).filter((r) => keepUrl(r.url))
  }
}
