import {
  READ_ONLY_PERSONAL_LIST_REQUIRED_RELAY_URLS
} from '@/constants'
import { isMetadataPolicyOperationScopedRelay } from '@/lib/metadata-policy-curated-relays'
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
/** Relay detail page mounted: explicit single-relay browse must not be blocked by strikes / user blocks / list gates. */
let singleRelayExplicitBrowseDepth = 0
/** In-flight authoritative single-relay timeline REQ (see {@link enterSingleRelayExplicitFetchScope}). */
let singleRelayExplicitFetchDepth = 0
/** In-flight query/subscribe URLs (constants + caller stack) allowed to connect briefly under metadata-only policy. */
const operationScopedRelayKeys = new Set<string>()

/** Dispatched when metadata-only relay policy toggles (feeds should rebuild relay URL lists). */
export const METADATA_RELAYS_ONLY_POLICY_CHANGED_EVENT = 'jumble:metadata-relays-only-changed'

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

/** Logged-in viewer with metadata-only mode: only connect reads to the viewer's relay lists. */
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
 * Under metadata-only policy: viewer NIP-65 / favorites / cache / HTTP lists, plus aggr.nostr.land when
 * wss://nostr.land is listed, plus relays in an active {@link grantRelayConnectionOperationScope}.
 */
export function isRelayAllowedUnderMetadataOnlyPolicy(url: string): boolean {
  if (isRelayUrlInViewerMetadataLists(url)) return true
  if (getViewerRelayStackNostrLandAggrEligible() && relayUrlIsAggrNostrLand(url)) return true
  const key = relayUrlKey(url)
  if (key.length > 0 && operationScopedRelayKeys.has(key)) return true
  return false
}

/**
 * Allow read connects to non-personal relays only for the lifetime of an in-flight query/subscribe.
 * Under metadata-only policy, only {@link isMetadataPolicyOperationScopedRelay} URLs are granted
 * (document / GIF / profile stacks — not FAST_READ or feed widening).
 */
export function grantRelayConnectionOperationScope(urls: readonly string[]): () => void {
  if (!isMetadataRelaysOnlyPolicyActive()) return () => {}
  const added: string[] = []
  for (const raw of urls) {
    if (isRelayUrlInViewerMetadataLists(raw)) continue
    if (getViewerRelayStackNostrLandAggrEligible() && relayUrlIsAggrNostrLand(raw)) continue
    if (
      !isMetadataPolicyOperationScopedRelay(raw) &&
      !(urls.length === 1 && isSingleRelayExplicitPolicyActive())
    ) {
      continue
    }
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

/** Block read-side pool connects / HTTP index fetches when metadata-only policy is on. */
export function isRelayConnectionAllowedForViewer(url: string): boolean {
  if (isSingleRelayExplicitPolicyActive()) return true
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

/** Under metadata-only policy: viewer relay lists + aggr.nostr.land when nostr.land is listed. */
function filterRelayUrlsToMetadataOnlyPersonalLists(
  urls: readonly string[],
  personalKeys: ReadonlySet<string>
): string[] {
  return urls.filter((u) => {
    const key = relayUrlKey(u)
    if (key.length > 0 && personalKeys.has(key)) return true
    if (getViewerRelayStackNostrLandAggrEligible() && relayUrlIsAggrNostrLand(u)) return true
    return false
  })
}

/** When metadata-only is on, omit global FAST_READ / trending widening from REQ stacks. */
export function viewerIncludeGlobalFastReadRelayLayer(): boolean {
  return !isMetadataRelaysOnlyPolicyActive()
}

/** When metadata-only is on, omit {@link FAST_WRITE_RELAY_URLS} from read-side merge/fetch stacks (publish unchanged). */
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
