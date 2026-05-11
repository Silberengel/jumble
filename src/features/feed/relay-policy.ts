import {
  READ_ONLY_RELAY_URLS,
  SOCIAL_KIND_BLOCKED_RELAY_URLS,
  relayFilterIncludesSocialKindBlockedKind
} from '@/constants'
import { AGGR_NOSTR_LAND_WSS } from '@/lib/nostr-land-aggr'
import {
  relayFiltersUseCapitalLetterTagKeys,
  relayUrlsStripExtendedTagReqBlocked
} from '@/lib/relay-extended-tag-req-blocks'
import { isLocalNetworkUrl, normalizeAnyRelayUrl } from '@/lib/url'
import type { TSubRequestFilter } from '@/types'

export type FeedRelayOperation = 'read' | 'write' | 'publish-picker' | 'favorites-feed'

export type FeedRelayDropReason =
  | 'invalid'
  | 'duplicate'
  | 'user-blocked'
  | 'read-only-for-write'
  | 'social-kind-blocked'
  | 'extended-tag-blocked'
  | 'third-party-local'
  | 'over-cap'
  | 'favorites-feed-aggr'

export type FeedRelayLayerSource =
  | 'explicit'
  | 'viewer-read'
  | 'viewer-write'
  | 'author-read'
  | 'author-write'
  | 'favorites'
  | 'fast-read'
  | 'fast-write'
  | 'read-only'
  | 'search'
  | 'cache'
  | 'http-index'
  | 'relay-hint'
  | 'seen-on'
  | 'fallback'

export type FeedRelayLayer = {
  source: FeedRelayLayerSource | string
  urls: readonly string[]
  /**
   * True when the layer is explicitly selected by the viewer for this surface
   * (for example a single-relay feed). Explicit single-relay reads can opt out
   * of local/social stripping that would otherwise hide the selected relay.
   */
  explicit?: boolean
}

export type FeedRelayDrop = {
  url: string
  normalizedUrl: string
  source: FeedRelayLayerSource | string
  reason: FeedRelayDropReason
}

export type FeedRelayPolicyContext = {
  operation: FeedRelayOperation
  blockedRelays?: readonly string[]
  filters?: readonly TSubRequestFilter[]
  eventKind?: number
  maxRelays?: number
  /**
   * Default: read surfaces include aggr.nostr.land; favorites and write
   * surfaces do not. Set explicitly for specialized fetches.
   */
  nostrLandAggr?: 'default' | 'always' | 'never'
  applySocialKindBlockedFilter?: boolean
  applyExtendedTagBlockedFilter?: boolean
  preserveSingleExplicitRelay?: boolean
  socialKindBlockedExemptRelays?: readonly string[]
  allowThirdPartyLocalRelays?: boolean
}

export type FeedRelayPolicyResult = {
  urls: string[]
  dropped: FeedRelayDrop[]
}

function canonicalRelayUrl(url: string | undefined | null): string {
  return (normalizeAnyRelayUrl(url ?? '') || (url ?? '').trim()).toLowerCase()
}

function normalizedRelayUrl(url: string): string {
  return normalizeAnyRelayUrl(url) || url.trim()
}

function normalizedSet(urls: readonly string[] | undefined): Set<string> {
  return new Set((urls ?? []).map(canonicalRelayUrl).filter(Boolean))
}

function shouldApplySocialFilter(ctx: FeedRelayPolicyContext): boolean {
  if (ctx.applySocialKindBlockedFilter !== undefined) return ctx.applySocialKindBlockedFilter
  if (ctx.eventKind !== undefined) return relayFilterIncludesSocialKindBlockedKind({ kinds: [ctx.eventKind], limit: 1 })
  return (ctx.filters ?? []).some((filter) => relayFilterIncludesSocialKindBlockedKind(filter))
}

function shouldApplyExtendedTagFilter(ctx: FeedRelayPolicyContext): boolean {
  if (ctx.applyExtendedTagBlockedFilter !== undefined) return ctx.applyExtendedTagBlockedFilter
  return (ctx.filters ?? []).some((filter) => relayFiltersUseCapitalLetterTagKeys([filter]))
}

function shouldEnsureAggr(ctx: FeedRelayPolicyContext): boolean {
  if (ctx.nostrLandAggr === 'always') return true
  if (ctx.nostrLandAggr === 'never') return false
  return ctx.operation === 'read'
}

function isReadOnlyRelay(norm: string): boolean {
  return normalizedSet(READ_ONLY_RELAY_URLS).has(norm)
}

function isSocialKindBlockedRelay(norm: string): boolean {
  return normalizedSet(SOCIAL_KIND_BLOCKED_RELAY_URLS).has(norm)
}

function isExtendedTagBlockedRelay(norm: string): boolean {
  const stripped = relayUrlsStripExtendedTagReqBlocked([norm])
  return stripped.length === 0
}

function addDrop(
  dropped: FeedRelayDrop[],
  url: string,
  source: FeedRelayLayerSource | string,
  reason: FeedRelayDropReason
) {
  dropped.push({
    url,
    normalizedUrl: normalizedRelayUrl(url),
    source,
    reason
  })
}

export function applyFeedRelayPolicy(
  inputLayers: readonly FeedRelayLayer[],
  context: FeedRelayPolicyContext
): FeedRelayPolicyResult {
  const blocked = normalizedSet(context.blockedRelays)
  const socialExempt = normalizedSet(context.socialKindBlockedExemptRelays)
  const socialFilter = shouldApplySocialFilter(context)
  const extendedFilter = shouldApplyExtendedTagFilter(context)
  const max = context.maxRelays ?? Number.POSITIVE_INFINITY
  const layers: FeedRelayLayer[] = shouldEnsureAggr(context)
    ? [{ source: 'read-only', urls: [AGGR_NOSTR_LAND_WSS] }, ...inputLayers]
    : [...inputLayers]
  const seen = new Set<string>()
  const dropped: FeedRelayDrop[] = []
  const urls: string[] = []

  for (const layer of layers) {
    for (const raw of layer.urls) {
      const normalized = normalizedRelayUrl(raw)
      const key = canonicalRelayUrl(normalized)
      if (!normalized || !key) {
        addDrop(dropped, raw, layer.source, 'invalid')
        continue
      }
      if (seen.has(key)) {
        addDrop(dropped, normalized, layer.source, 'duplicate')
        continue
      }
      if (blocked.has(key)) {
        addDrop(dropped, normalized, layer.source, 'user-blocked')
        continue
      }
      if (context.operation === 'favorites-feed' && key === canonicalRelayUrl(AGGR_NOSTR_LAND_WSS)) {
        addDrop(dropped, normalized, layer.source, 'favorites-feed-aggr')
        continue
      }
      if (
        (context.operation === 'write' || context.operation === 'publish-picker') &&
        isReadOnlyRelay(key)
      ) {
        addDrop(dropped, normalized, layer.source, 'read-only-for-write')
        continue
      }
      if (
        socialFilter &&
        isSocialKindBlockedRelay(key) &&
        !socialExempt.has(key) &&
        !(context.preserveSingleExplicitRelay && layer.explicit && layer.urls.length === 1)
      ) {
        addDrop(dropped, normalized, layer.source, 'social-kind-blocked')
        continue
      }
      if (extendedFilter && isExtendedTagBlockedRelay(normalized)) {
        addDrop(dropped, normalized, layer.source, 'extended-tag-blocked')
        continue
      }
      if (!context.allowThirdPartyLocalRelays && isLocalNetworkUrl(normalized) && !layer.explicit) {
        addDrop(dropped, normalized, layer.source, 'third-party-local')
        continue
      }
      if (urls.length >= max) {
        addDrop(dropped, normalized, layer.source, 'over-cap')
        continue
      }
      seen.add(key)
      urls.push(normalized)
    }
  }

  return { urls, dropped }
}

export function feedRelayPolicyUrls(
  layers: readonly FeedRelayLayer[],
  context: FeedRelayPolicyContext
): string[] {
  return applyFeedRelayPolicy(layers, context).urls
}
