import { READ_ONLY_PERSONAL_LIST_REQUIRED_RELAY_URLS } from '@/constants'
import { normalizeAnyRelayUrl } from '@/lib/url'

const personalListRequiredKeySet = new Set(
  READ_ONLY_PERSONAL_LIST_REQUIRED_RELAY_URLS.map((u) =>
    (normalizeAnyRelayUrl(u) || u).toLowerCase()
  ).filter(Boolean)
)

let viewerPersonalRelayKeys = new Set<string>()

export function relayUrlKey(url: string): string {
  return (normalizeAnyRelayUrl(url) || url.trim()).toLowerCase()
}

/** True when the relay must be on the viewer's personal lists before connect / AUTH. */
export function isPersonalListRequiredReadOnlyRelay(url: string): boolean {
  const key = relayUrlKey(url)
  return key.length > 0 && personalListRequiredKeySet.has(key)
}

/** @deprecated Use {@link isPersonalListRequiredReadOnlyRelay}; kept for NIP-42 call sites. */
export function isReadOnlyIndexerRelay(url: string): boolean {
  return isPersonalListRequiredReadOnlyRelay(url)
}

export function buildPersonalRelayKeySet(urls: readonly string[]): Set<string> {
  const out = new Set<string>()
  for (const u of urls) {
    const key = relayUrlKey(u)
    if (key) out.add(key)
  }
  return out
}

/** Updated when the logged-in viewer's NIP-65 / favorites / cache relays hydrate. */
export function setViewerPersonalRelayKeys(keys: ReadonlySet<string>): void {
  viewerPersonalRelayKeys = new Set(keys)
}

export function getViewerPersonalRelayKeys(): ReadonlySet<string> {
  return viewerPersonalRelayKeys
}

export function isReadOnlyRelayAllowedForViewer(url: string): boolean {
  if (!isPersonalListRequiredReadOnlyRelay(url)) return true
  const key = relayUrlKey(url)
  return key.length > 0 && viewerPersonalRelayKeys.has(key)
}

function isAllowedForKeys(url: string, personalKeys: ReadonlySet<string>): boolean {
  if (!isPersonalListRequiredReadOnlyRelay(url)) return true
  const key = relayUrlKey(url)
  return key.length > 0 && personalKeys.has(key)
}

/**
 * Drop {@link READ_ONLY_PERSONAL_LIST_REQUIRED_RELAY_URLS} unless the viewer listed them on NIP-65 / favorites / 10432.
 * Other read-only index relays (aggr.nostr.land, search.nos.today, …) are unchanged.
 */
export function filterReadOnlyRelaysUnlessPersonal(
  urls: readonly string[],
  personalKeys?: ReadonlySet<string>
): string[] {
  const keys = personalKeys ?? viewerPersonalRelayKeys
  return urls.filter((u) => isAllowedForKeys(u, keys))
}
