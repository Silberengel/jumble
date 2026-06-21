import {
  READ_ONLY_PERSONAL_LIST_REQUIRED_RELAY_URLS
} from '@/constants'
import { isMetadataPolicyActiveReadGrantRelay, isMetadataPolicyProfileRelay } from '@/lib/metadata-policy-curated-relays'
import {
  filterAggrNostrLandUnlessViewerEligible,
  getViewerRelayStackNostrLandAggrEligible,
  relayUrlIsAggrNostrLand
} from '@/lib/nostr-land-relay-eligibility'
import { urlIsNonLocalForRemoteViewer } from '@/lib/relay-list-sanitize'
import { isViewerRelayBlocked } from '@/lib/viewer-blocked-relays'
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
let viewerPersonalRelayKeysRevision = 0

/** Fired when {@link setViewerPersonalRelayKeys} changes keys or viewer policy (feeds re-subscribe). */
export const VIEWER_PERSONAL_RELAY_KEYS_SYNCED_EVENT = 'imwald:viewer-personal-relay-keys-synced'

export function getViewerPersonalRelayKeysRevision(): number {
  return viewerPersonalRelayKeysRevision
}

function personalRelayKeySetsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const key of a) {
    if (!b.has(key)) return false
  }
  return true
}
/** Relay detail page mounted: explicit single-relay browse must not be blocked by strikes / user blocks / list gates. */
let singleRelayExplicitBrowseDepth = 0
/** In-flight authoritative single-relay timeline REQ (see {@link enterSingleRelayExplicitFetchScope}). */
let singleRelayExplicitFetchDepth = 0
/** In-flight query/subscribe URLs allowed to connect briefly under the personal-relay read policy. */
const operationScopedRelayKeys = new Set<string>()

export function enterSingleRelayExplicitBrowse(): void {
  singleRelayExplicitBrowseDepth++
}

export function leaveSingleRelayExplicitBrowse(): void {
  singleRelayExplicitBrowseDepth = Math.max(0, singleRelayExplicitBrowseDepth - 1)
}

export function isSingleRelayExplicitBrowseActive(): boolean {
  return singleRelayExplicitBrowseDepth > 0
}

/** While active, {@link sanitizeRelayUrlsForFetch} and pool connects honor the lone target relay. */
export function enterSingleRelayExplicitFetchScope(): () => void {
  singleRelayExplicitFetchDepth++
  return () => {
    singleRelayExplicitFetchDepth = Math.max(0, singleRelayExplicitFetchDepth - 1)
  }
}

export function isSingleRelayExplicitFetchScopeActive(): boolean {
  return singleRelayExplicitFetchDepth > 0
}

/** True while an explicit single-relay browse page or authoritative timeline REQ is active. */
export function isSingleRelayExplicitPolicyActive(): boolean {
  return isSingleRelayExplicitBrowseActive() || isSingleRelayExplicitFetchScopeActive()
}

function shouldPreserveExplicitSingleRelay(
  urls: readonly string[],
  preserveExplicitSingleRelay?: boolean
): boolean {
  if (urls.length !== 1) return false
  if (preserveExplicitSingleRelay === true) return true
  return isSingleRelayExplicitPolicyActive()
}

/**
 * Logged-in viewer: only connect reads to personal relay lists, aggr when eligible,
 * operation-scoped URLs, and explicit single-relay browse.
 */
export function isMetadataRelaysOnlyPolicyActive(): boolean {
  return viewerMetadataRelaysPolicyActive
}

export function isRelayUrlInViewerMetadataLists(url: string): boolean {
  const key = relayUrlKey(url)
  return key.length > 0 && viewerPersonalRelayKeys.has(key)
}

/**
 * Under personal-relay read policy: viewer NIP-65 / favorites / cache / HTTP lists, aggr.nostr.land when
 * wss://nostr.land is listed, {@link PROFILE_RELAY_URLS}, plus relays in an active operation scope.
 */
export function isRelayAllowedUnderMetadataOnlyPolicy(url: string): boolean {
  if (isRelayUrlInViewerMetadataLists(url)) return true
  if (getViewerRelayStackNostrLandAggrEligible() && relayUrlIsAggrNostrLand(url)) return true
  if (isMetadataPolicyProfileRelay(url)) return true
  const key = relayUrlKey(url)
  if (key.length > 0 && operationScopedRelayKeys.has(key)) return true
  return false
}

/**
 * Allow read connects to non-personal relays only for the lifetime of an in-flight query/subscribe.
 * Call with the caller's intended URL list **before** {@link sanitizeRelayUrlsForFetch}.
 */
export function grantRelayConnectionOperationScope(urls: readonly string[]): () => void {
  if (!isMetadataRelaysOnlyPolicyActive()) return () => {}
  const singleExplicit = urls.length === 1 && isSingleRelayExplicitPolicyActive()
  const added: string[] = []
  for (const raw of urls) {
    if (isRelayUrlInViewerMetadataLists(raw)) continue
    if (getViewerRelayStackNostrLandAggrEligible() && relayUrlIsAggrNostrLand(raw)) continue
    if (isMetadataPolicyProfileRelay(raw)) continue
    if (!isMetadataPolicyActiveReadGrantRelay(raw) && !singleExplicit) continue
    const key = relayUrlKey(raw)
    if (!key || operationScopedRelayKeys.has(key)) continue
    operationScopedRelayKeys.add(key)
    added.push(key)
  }
  return () => {
    for (const key of added) operationScopedRelayKeys.delete(key)
  }
}

/**
 * Short-lived read access for relay URLs from event tag hints (`a`/`e`/`q` position 3, naddr relays).
 * Used when resolving a missing embedded note — the publisher pointed at these relays explicitly.
 */
export function grantEventTagRelayHintScope(urls: readonly string[]): () => void {
  if (!isMetadataRelaysOnlyPolicyActive()) return () => {}
  const added: string[] = []
  for (const raw of urls) {
    if (!urlIsNonLocalForRemoteViewer(raw)) continue
    const key = relayUrlKey(raw)
    if (!key || operationScopedRelayKeys.has(key)) continue
    operationScopedRelayKeys.add(key)
    added.push(key)
  }
  return () => {
    for (const key of added) operationScopedRelayKeys.delete(key)
  }
}

/** @internal */
export function resetRelayConnectionOperationScopeForTests(): void {
  operationScopedRelayKeys.clear()
}

/** Block read-side pool connects / HTTP index fetches when personal-relay policy is on. */
export function isRelayConnectionAllowedForViewer(url: string): boolean {
  if (isSingleRelayExplicitPolicyActive()) return true
  if (isViewerRelayBlocked(url)) return false
  if (!isMetadataRelaysOnlyPolicyActive()) return true
  return isRelayAllowedUnderMetadataOnlyPolicy(url)
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
  const prevKeys = viewerPersonalRelayKeys
  const prevPolicyActive = viewerMetadataRelaysPolicyActive
  viewerPersonalRelayKeys = new Set(keys)
  if (policy?.viewerActive !== undefined) {
    viewerMetadataRelaysPolicyActive = policy.viewerActive
  }
  const keysChanged = !personalRelayKeySetsEqual(prevKeys, viewerPersonalRelayKeys)
  const policyChanged =
    policy?.viewerActive !== undefined && policy.viewerActive !== prevPolicyActive
  if (!keysChanged && !policyChanged) return
  viewerPersonalRelayKeysRevision += 1
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(VIEWER_PERSONAL_RELAY_KEYS_SYNCED_EVENT, {
        detail: { revision: viewerPersonalRelayKeysRevision }
      })
    )
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

/** Under personal-relay policy: viewer lists + aggr + profile index + in-flight operation scope. */
function filterRelayUrlsToMetadataOnlyPersonalLists(
  urls: readonly string[],
  personalKeys: ReadonlySet<string>
): string[] {
  return urls.filter((u) => {
    const key = relayUrlKey(u)
    if (key.length > 0 && personalKeys.has(key)) return true
    if (getViewerRelayStackNostrLandAggrEligible() && relayUrlIsAggrNostrLand(u)) return true
    if (isMetadataPolicyProfileRelay(u)) return true
    if (key.length > 0 && operationScopedRelayKeys.has(key)) return true
    return false
  })
}

/** Omit global FAST_READ / trending widening from REQ stacks under personal-relay policy. */
export function viewerIncludeGlobalFastReadRelayLayer(): boolean {
  return !isMetadataRelaysOnlyPolicyActive()
}

/** Omit {@link FAST_WRITE_RELAY_URLS} from read-side merge/fetch stacks (publish unchanged). */
export function viewerIncludeGlobalFastWriteRelayLayer(): boolean {
  return !isMetadataRelaysOnlyPolicyActive()
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
  personalKeys?: ReadonlySet<string>,
  opts?: { preserveExplicitSingleRelay?: boolean }
): string[] {
  if (shouldPreserveExplicitSingleRelay(urls, opts?.preserveExplicitSingleRelay)) {
    const raw = urls[0]!.trim()
    if (!raw) return []
    return [normalizeAnyRelayUrl(raw) || raw]
  }
  const keys = personalKeys ?? viewerPersonalRelayKeys
  const withoutThirdPartyLocals = urls.filter((u) => {
    if (urlIsNonLocalForRemoteViewer(u)) return true
    const key = relayUrlKey(u)
    return key.length > 0 && keys.has(key)
  })
  let out = filterViewerBlockedRelaysForFetch(
    filterAggrNostrLandUnlessViewerEligible(
      filterReadOnlyRelaysUnlessPersonal(withoutThirdPartyLocals, keys)
    )
  )
  if (isMetadataRelaysOnlyPolicyActive()) {
    out = filterRelayUrlsToMetadataOnlyPersonalLists(out, keys)
  }
  return out
}
