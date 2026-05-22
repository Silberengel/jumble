import {
  DEFAULT_FAVORITE_RELAYS,
  FAST_READ_RELAY_URLS,
  FAST_WRITE_RELAY_URLS,
  READ_ONLY_PERSONAL_LIST_REQUIRED_RELAY_URLS
} from '@/constants'
import { isMetadataPolicyCuratedRelay } from '@/lib/metadata-policy-curated-relays'
import {
  filterAggrNostrLandUnlessViewerEligible,
  getViewerRelayStackNostrLandAggrEligible,
  relayUrlIsAggrNostrLand
} from '@/lib/nostr-land-relay-eligibility'
import { urlIsNonLocalForRemoteViewer } from '@/lib/relay-list-sanitize'
import { filterViewerBlockedRelaysForFetch } from '@/lib/viewer-blocked-relays'
import { normalizeAnyRelayUrl } from '@/lib/url'

const personalListRequiredKeySet = new Set(
  READ_ONLY_PERSONAL_LIST_REQUIRED_RELAY_URLS.map((u) =>
    (normalizeAnyRelayUrl(u) || u).toLowerCase()
  ).filter(Boolean)
)

let viewerPersonalRelayKeys = new Set<string>()
/** True after a logged-in viewer's personal relay keys were synced (including empty lists). */
let viewerMetadataRelaysPolicyActive = false
let restrictConnectionsToMetadataRelaysOnly = false
/** Relay explore / search UI: metadata-only policy must not narrow relays on those pages. */
let metadataRelaysOnlyBypassDepth = 0

export function setRestrictConnectionsToMetadataRelaysOnly(enabled: boolean): void {
  restrictConnectionsToMetadataRelaysOnly = enabled
}

export function isRestrictConnectionsToMetadataRelaysOnly(): boolean {
  return restrictConnectionsToMetadataRelaysOnly
}

export function enterMetadataRelaysOnlyBypass(): void {
  metadataRelaysOnlyBypassDepth++
}

export function leaveMetadataRelaysOnlyBypass(): void {
  metadataRelaysOnlyBypassDepth = Math.max(0, metadataRelaysOnlyBypassDepth - 1)
}

export function isMetadataRelaysOnlyBypassActive(): boolean {
  return metadataRelaysOnlyBypassDepth > 0
}

let metadataPolicyBootstrapBlockedKeys: ReadonlySet<string> | null = null

function getMetadataPolicyBootstrapBlockedKeys(): ReadonlySet<string> {
  if (!metadataPolicyBootstrapBlockedKeys) {
    const out = new Set<string>()
    for (const list of [FAST_READ_RELAY_URLS, FAST_WRITE_RELAY_URLS, DEFAULT_FAVORITE_RELAYS]) {
      for (const u of list) {
        const key = relayUrlKey(u)
        if (key) out.add(key)
      }
    }
    metadataPolicyBootstrapBlockedKeys = out
  }
  return metadataPolicyBootstrapBlockedKeys
}

/** True when URL is only a generic bootstrap mirror (FAST_READ / FAST_WRITE / default favorites). */
export function isMetadataPolicyBootstrapRelay(url: string): boolean {
  const key = relayUrlKey(url)
  return key.length > 0 && getMetadataPolicyBootstrapBlockedKeys().has(key)
}

/** Logged-in viewer with metadata-only mode: block FAST_READ widening, keep curated stacks. */
export function isMetadataRelaysOnlyPolicyActive(): boolean {
  return (
    restrictConnectionsToMetadataRelaysOnly &&
    viewerMetadataRelaysPolicyActive &&
    !isMetadataRelaysOnlyBypassActive()
  )
}

export function isRelayUrlInViewerMetadataLists(url: string): boolean {
  const key = relayUrlKey(url)
  return key.length > 0 && viewerPersonalRelayKeys.has(key)
}

/**
 * Under metadata-only policy: viewer lists, Nostr Land aggr, and {@link isMetadataPolicyCuratedRelay}
 * (profile / read-only / searchable / document stacks). Blocks ad-hoc relays and FAST_READ bootstrap only.
 */
export function isRelayAllowedUnderMetadataOnlyPolicy(url: string): boolean {
  if (isRelayUrlInViewerMetadataLists(url)) return true
  if (getViewerRelayStackNostrLandAggrEligible() && relayUrlIsAggrNostrLand(url)) return true
  if (isMetadataPolicyCuratedRelay(url)) return true
  if (isMetadataPolicyBootstrapRelay(url)) return false
  return false
}

/** Block WebSocket (and other) pool connects when metadata-only policy is on. */
export function isRelayConnectionAllowedForViewer(url: string): boolean {
  if (!isMetadataRelaysOnlyPolicyActive()) return true
  return isRelayAllowedUnderMetadataOnlyPolicy(url)
}

function filterToViewerMetadataRelaysOnly(urls: readonly string[]): string[] {
  if (!isMetadataRelaysOnlyPolicyActive()) return [...urls]
  return urls.filter((u) => isRelayAllowedUnderMetadataOnlyPolicy(u))
}

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
export function setViewerPersonalRelayKeys(
  keys: ReadonlySet<string>,
  policy?: { viewerActive?: boolean }
): void {
  viewerPersonalRelayKeys = new Set(keys)
  if (policy?.viewerActive !== undefined) {
    viewerMetadataRelaysPolicyActive = policy.viewerActive
  }
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

/**
 * Sanitize relay URLs assembled for REQ/fetch: drop other people's LAN/localhost hints (keep viewer's
 * own locals from NIP-65 / favorites / 10432), then gated read-only indexers.
 */
export function sanitizeRelayUrlsForFetch(
  urls: readonly string[],
  personalKeys?: ReadonlySet<string>
): string[] {
  const keys = personalKeys ?? viewerPersonalRelayKeys
  const withoutThirdPartyLocals = urls.filter((u) => {
    if (urlIsNonLocalForRemoteViewer(u)) return true
    const key = relayUrlKey(u)
    return key.length > 0 && keys.has(key)
  })
  return filterToViewerMetadataRelaysOnly(
    filterViewerBlockedRelaysForFetch(
      filterAggrNostrLandUnlessViewerEligible(
        filterReadOnlyRelaysUnlessPersonal(withoutThirdPartyLocals, keys)
      )
    )
  )
}
