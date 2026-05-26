import { getCacheRelayUrls } from '@/lib/private-relays'
import { dedupeNormalizeRelayUrlsOrdered } from '@/lib/relay-url-priority'
import { normalizeAnyRelayUrl, normalizeHttpRelayUrl, normalizeUrl } from '@/lib/url'
import type { TRelayList } from '@/types'

export type WriteOutboxSource = Pick<TRelayList, 'write' | 'httpWrite'> | {
  write?: string[]
  httpWrite?: string[]
}

function relayKey(url: string): string {
  return (normalizeAnyRelayUrl(url) || url.trim()).toLowerCase()
}

/**
 * Logged-in user's write outbox: kind 10432 cache, then kind 10243 HTTP write, then kind 10002 WS write.
 * Pass `cacheUrls` when kind 10432 is stored separately; those URLs are stripped from the WS layer.
 */
export function collectUserWriteOutboxUrls(
  relayList: WriteOutboxSource | null | undefined,
  cacheUrls: readonly string[] = [],
  extraWriteUrls: readonly string[] = []
): string[] {
  const cache = cacheUrls
    .map((u) => normalizeUrl(u) || u.trim())
    .filter(Boolean)
  const cacheKeys = new Set(cache.map(relayKey))
  const http = (relayList?.httpWrite ?? [])
    .map((u) => normalizeHttpRelayUrl(u) || u)
    .filter((u): u is string => !!u)
  const ws = (relayList?.write ?? [])
    .map((u) => normalizeUrl(u) || u)
    .filter((u): u is string => !!u)
    .filter((u) => cacheKeys.size === 0 || !cacheKeys.has(relayKey(u)))
  return dedupeNormalizeRelayUrlsOrdered([...cache, ...http, ...ws, ...extraWriteUrls])
}

/**
 * Kind 10243 HTTP + kind 10002 WS write fields from a mailbox list (no kind 10432).
 * Use for third-party authors; for the viewer prefer {@link collectUserWriteOutboxUrls}.
 */
export function collectWriteOutboxUrlsFromRelayList(
  relayList: WriteOutboxSource | null | undefined,
  extraWriteUrls: readonly string[] = []
): string[] {
  return collectUserWriteOutboxUrls(relayList, [], extraWriteUrls)
}

/** @deprecated use {@link collectUserWriteOutboxUrls} */
export function collectWriteOutboxUrlsWithExtraCache(
  relayList: WriteOutboxSource | null | undefined,
  cacheUrls: readonly string[],
  extraWriteUrls: readonly string[] = []
): string[] {
  return collectUserWriteOutboxUrls(relayList, cacheUrls, extraWriteUrls)
}

/**
 * Full viewer publish outbox: kind 10432 cache (IndexedDB) + kind 10243 HTTP + kind 10002 WS.
 */
export async function collectViewerWriteOutboxUrls(
  pubkey: string,
  relayList: WriteOutboxSource | null | undefined,
  extraWriteUrls: readonly string[] = []
): Promise<string[]> {
  const cache = await getCacheRelayUrls(pubkey)
  return collectUserWriteOutboxUrls(relayList, cache, extraWriteUrls)
}

/** True when the viewer has any configured write outbox (10002, 10243, or 10432 cache). */
export async function viewerHasWriteOutboxes(
  pubkey: string,
  relayList: WriteOutboxSource | null | undefined
): Promise<boolean> {
  const urls = await collectViewerWriteOutboxUrls(pubkey, relayList)
  return urls.length > 0
}
