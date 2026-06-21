import { getCacheRelayUrls } from '@/lib/private-relays'
import { dedupeNormalizeRelayUrlsOrdered } from '@/lib/relay-url-priority'
import { isLocalNetworkUrl, normalizeAnyRelayUrl, normalizeHttpRelayUrl, normalizeUrl } from '@/lib/url'
import type { TRelayList } from '@/types'

export type ReadInboxSource = Pick<TRelayList, 'read' | 'httpRead'> | {
  read?: string[]
  httpRead?: string[]
}

function relayKey(url: string): string {
  return (normalizeAnyRelayUrl(url) || url.trim()).toLowerCase()
}

/**
 * Logged-in user's read inbox: kind 10432 cache, then kind 10243 HTTP read, then kind 10002 WS read.
 * Use this (or {@link userReadInboxUrls}) anywhere kind-10002 `read` inboxes are merged into relay lists —
 * do not use `relayList.read` alone.
 * Pass `cacheUrls` when kind 10432 is stored separately (e.g. from {@link cacheRelayListEvent});
 * those URLs are stripped from the WS layer so each relay appears once with cache-first ordering.
 */
export function collectUserReadInboxUrls(
  relayList: ReadInboxSource | null | undefined,
  cacheUrls: readonly string[] = [],
  extraReadUrls: readonly string[] = []
): string[] {
  const cache = cacheUrls
    .map((u) => normalizeUrl(u) || u.trim())
    .filter(Boolean)
  const cacheKeys = new Set(cache.map(relayKey))
  const http = (relayList?.httpRead ?? [])
    .map((u) => normalizeHttpRelayUrl(u) || u)
    .filter((u): u is string => !!u)
  const ws = (relayList?.read ?? [])
    .map((u) => normalizeUrl(u) || u)
    .filter((u): u is string => !!u)
    .filter((u) => cacheKeys.size === 0 || !cacheKeys.has(relayKey(u)))
  return dedupeNormalizeRelayUrlsOrdered([...cache, ...http, ...ws, ...extraReadUrls])
}

/**
 * Kind 10243 HTTP + kind 10002 WS read fields from a mailbox list (no kind 10432).
 * Use for third-party authors; for the viewer prefer {@link collectUserReadInboxUrls}.
 */
export function collectReadInboxUrlsFromRelayList(
  relayList: ReadInboxSource | null | undefined,
  extraReadUrls: readonly string[] = []
): string[] {
  return collectUserReadInboxUrls(relayList, [], extraReadUrls)
}

/** NIP-65 / 10243 inbox URLs for a recipient (drops other people's LAN/loopback). */
export function collectRemoteReadInboxUrlsFromRelayList(
  relayList: ReadInboxSource | null | undefined,
  extraReadUrls: readonly string[] = []
): string[] {
  return collectReadInboxUrlsFromRelayList(relayList, extraReadUrls).filter(
    (u) => !isLocalNetworkUrl(u)
  )
}

/** @deprecated use {@link collectUserReadInboxUrls} */
export function collectReadInboxUrlsWithExtraCache(
  relayList: ReadInboxSource | null | undefined,
  cacheUrls: readonly string[],
  extraReadUrls: readonly string[] = []
): string[] {
  return collectUserReadInboxUrls(relayList, cacheUrls, extraReadUrls)
}

/**
 * Full viewer read inbox: kind 10432 cache (IndexedDB) + kind 10243 HTTP + kind 10002 WS.
 */
export async function collectViewerReadInboxUrls(
  pubkey: string,
  relayList: ReadInboxSource | null | undefined,
  extraReadUrls: readonly string[] = []
): Promise<string[]> {
  const cache = await getCacheRelayUrls(pubkey)
  return collectUserReadInboxUrls(relayList, cache, extraReadUrls)
}

/** True when the viewer has any configured read inbox (10002, 10243, or 10432 cache). */
export async function viewerHasReadInboxes(
  pubkey: string,
  relayList: ReadInboxSource | null | undefined
): Promise<boolean> {
  const urls = await collectViewerReadInboxUrls(pubkey, relayList)
  return urls.length > 0
}
