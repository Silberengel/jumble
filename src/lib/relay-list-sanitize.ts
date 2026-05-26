import {
  isLocalNetworkUrl,
  normalizeAnyRelayUrl,
  normalizeHttpRelayUrl,
  normalizeRelayUrlByScheme,
  normalizeUrl
} from '@/lib/url'
import type { TMailboxRelay, TMailboxRelayScope, TRelayList } from '@/types'

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
 * Remove loopback/LAN URLs from tag, nevent, or seen-on hints. The viewer's own cache relays (kind 10432)
 * are added separately via {@link getCacheRelayUrls} — never from another user's `e` tag hint.
 */
export function stripLocalRelaysFromThirdPartyHints(urls: readonly string[]): string[] {
  return urls.filter(urlIsNonLocalForRemoteViewer)
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
  const keepWsUrl = (u: string): boolean => {
    const n = normalizeUrl(u) || u
    return Boolean(n && !isLocalNetworkUrl(n))
  }
  const keepHttpIndexUrl = (u: string): boolean => {
    const n = normalizeHttpRelayUrl(u) || u
    return Boolean(n && !isLocalNetworkUrl(n))
  }
  return {
    write: list.write.filter(keepWsUrl),
    read: list.read.filter(keepWsUrl),
    originalRelays: list.originalRelays.filter((r) => keepWsUrl(r.url)),
    httpWrite: (list.httpWrite ?? []).filter(keepHttpIndexUrl),
    httpRead: (list.httpRead ?? []).filter(keepHttpIndexUrl),
    httpOriginalRelays: (list.httpOriginalRelays ?? []).filter((r) => keepHttpIndexUrl(r.url))
  }
}

/**
 * Drop loopback/LAN WebSocket relay URLs before REQ — they burn {@link MAX_CONCURRENT_RELAY_CONNECTIONS}
 * slots and time out in the browser, delaying public relays (e.g. Damus) that actually hold kind 0.
 */
export function stripLocalNetworkRelaysForWssReq(urls: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of urls) {
    if (/^https?:\/\//i.test(raw.trim())) continue
    const n = normalizeAnyRelayUrl(raw) || raw.trim()
    if (!n || isLocalNetworkUrl(n)) continue
    const key = (normalizeUrl(n) || n).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(n)
  }
  return out
}

const normRelayKey = (u: string): string => normalizeRelayUrlByScheme(u) || u.trim()

/**
 * When NIP-65 `originalRelays` is empty but `read` / `write` URL lists are filled (e.g. PROFILE_FETCH fallback),
 * build mailbox rows so UIs that only map `originalRelays` still render.
 */
export function syntheticOriginalRelaysFromReadWrite(read: string[], write: string[]): TMailboxRelay[] {
  const readByKey = new Map<string, string>()
  const writeByKey = new Map<string, string>()
  for (const u of read) {
    const k = normRelayKey(u)
    if (!k) continue
    if (!readByKey.has(k)) readByKey.set(k, u.trim())
  }
  for (const u of write) {
    const k = normRelayKey(u)
    if (!k) continue
    if (!writeByKey.has(k)) writeByKey.set(k, u.trim())
  }
  const keys = new Set([...readByKey.keys(), ...writeByKey.keys()])
  const rows: TMailboxRelay[] = []
  for (const k of keys) {
    const hasR = readByKey.has(k)
    const hasW = writeByKey.has(k)
    const url = (hasR ? readByKey.get(k) : writeByKey.get(k))!
    const scope: TMailboxRelayScope =
      hasR && hasW ? 'both' : hasR ? 'read' : 'write'
    rows.push({ url, scope })
  }
  rows.sort((a, b) => a.url.localeCompare(b.url))
  return rows
}
