import { isHttpRelayUrl, isLocalNetworkUrl, normalizeAnyRelayUrl, normalizeUrl } from '@/lib/url'
import type { TRelayList } from '@/types'

/** True if this URL is not loopback / LAN (safe to open from another user's browser as a REQ target). */
export function urlIsNonLocalForRemoteViewer(url: string): boolean {
  const t = typeof url === 'string' ? url.trim() : ''
  if (!t) return false
  if (isLocalNetworkUrl(t)) return false
  const n = normalizeAnyRelayUrl(t) || ''
  if (n && isLocalNetworkUrl(n)) return false
  return true
}

/**
 * Drop LAN/loopback from NIP-65 + HTTP mailbox fields when resolving **another** author's data:
 * the viewer cannot reach the author's `localhost` / `192.168.*` / etc., but we used to rank them first.
 */
export function stripMailboxLocalUrlsForRemoteViewers(list: {
  read: string[]
  write: string[]
  httpRead?: string[]
  httpWrite?: string[]
}): { read: string[]; write: string[]; httpRead: string[]; httpWrite: string[] } {
  const f = (arr: string[] | undefined) => (arr ?? []).filter(urlIsNonLocalForRemoteViewer)
  return {
    read: f(list.read),
    write: f(list.write),
    httpRead: f(list.httpRead),
    httpWrite: f(list.httpWrite)
  }
}

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
