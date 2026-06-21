import { feedRelayPolicyUrls } from '@/features/feed/relay-policy'
import { getFavoritesFeedRelayUrls } from '@/lib/favorites-feed-relays'
import { stripNostrLandAggrFromRelayUrls } from '@/lib/nostr-land-relay-eligibility'
import { isHomePrimaryFeedSubscriptionKey } from '@/lib/home-feed-relay-source'
import { isRelayBlockedByUser } from '@/lib/relay-blocked'
import { isMetadataRelaysOnlyPolicyActive } from '@/lib/read-only-relay-personal'
import { dedupeNormalizeRelayUrlsOrdered } from '@/lib/relay-url-priority'
import { normalizeAnyRelayUrl } from '@/lib/url'
import {
  ensureTrendingInFavoriteRelayList,
  isWispTrendingNotesRelayUrl
} from '@/lib/wisp-trending-relay'

export { stripNostrLandAggrFromRelayUrls }

/**
 * Home timeline REQs (Notes and Replies on `home-all-favorites`) must never hit aggr — only
 * favorites + Wisp trending (+ widened read layers on Replies without aggr). Side-panel threads,
 * reply blurbs, backlinks, embeds, and profiles use {@link feedRelayPolicyUrls} / comprehensive lists instead.
 */
export function stripNostrLandAggrFromTimelineSubRequests<T extends { urls: string[] }>(
  feedSubscriptionKey: string | undefined,
  requests: readonly T[]
): T[] {
  if (!isHomePrimaryFeedSubscriptionKey(feedSubscriptionKey)) {
    return requests.slice() as T[]
  }
  return requests.map((r) => ({
    ...r,
    urls: stripNostrLandAggrFromRelayUrls(r.urls)
  })) as T[]
}

/** Home favorites feed only: include the Wisp trending path relay (deduped). */
export function ensureHomeFeedTrendingRelay(urls: readonly string[]): string[] {
  return ensureTrendingInFavoriteRelayList(urls)
}

/** Relay-set home feed: selected set URLs only (no trending, no NIP-65 inbox widen). */
export function buildHomeRelaySetFeedRelayUrls(
  relayUrls: readonly string[],
  blockedRelays: readonly string[]
): string[] {
  const visible = relayUrls.filter((url) => {
    const key = normalizeAnyRelayUrl(url) || url.trim()
    return key && !isRelayBlockedByUser(url, blockedRelays)
  })
  return dedupeNormalizeRelayUrlsOrdered(visible)
}

/** {@link DEFAULT_FAVORITE_RELAYS} for the home feed (aggr stripped; not gated on FAST_READ policy). */
export function buildHomeDefaultFavoriteRelayUrls(blockedRelays: readonly string[]): string[] {
  return stripNostrLandAggrFromRelayUrls(getFavoritesFeedRelayUrls([], blockedRelays, true))
}

/** True when the stack has no real favorite/inbox relays (wisp trending alone does not count). */
function homeFeedUrlsNeedFastReadFallback(urls: readonly string[]): boolean {
  if (urls.length === 0) return true
  return urls.every((u) => isWispTrendingNotesRelayUrl(u))
}

export type HomeFeedRelayStackOptions = {
  /** Merge {@link DEFAULT_FAVORITE_RELAYS} when the viewer has no kind-10012 favorites configured. */
  supplementDefaultFavorites?: boolean
}

/** Last-resort home feed relays when favorites / inbox / extras produced nothing. */
export function ensureHomeFeedRelayUrlsHaveFallback(
  urls: readonly string[],
  blockedRelays: readonly string[],
  options?: HomeFeedRelayStackOptions
): string[] {
  const defaults = buildHomeDefaultFavoriteRelayUrls(blockedRelays)
  if (defaults.length === 0) return [...urls]
  const needsFallback =
    options?.supplementDefaultFavorites === true || homeFeedUrlsNeedFastReadFallback(urls)
  if (!needsFallback) return [...urls]
  return dedupeNormalizeRelayUrlsOrdered([...urls, ...defaults])
}

export function buildAllFavoritesFeedRelayUrls(
  favoriteRelays: string[],
  blockedRelays: string[],
  extraFeedRelayUrls: string[],
  useGlobalFavoriteDefaults = true,
  options?: HomeFeedRelayStackOptions
): string[] {
  const extras = isMetadataRelaysOnlyPolicyActive()
    ? extraFeedRelayUrls.filter((u) => !isWispTrendingNotesRelayUrl(u))
    : extraFeedRelayUrls
  return ensureHomeFeedTrendingRelay(
    ensureHomeFeedRelayUrlsHaveFallback(
      stripNostrLandAggrFromRelayUrls(
        feedRelayPolicyUrls(
          [
            {
              source: 'favorites',
              urls: getFavoritesFeedRelayUrls(favoriteRelays, blockedRelays, useGlobalFavoriteDefaults)
            },
            { source: 'fallback', urls: extras }
          ],
          {
            operation: 'favorites-feed',
            blockedRelays,
            nostrLandAggr: 'never',
            applySocialKindBlockedFilter: false,
            allowThirdPartyLocalRelays: true
          }
        )
      ),
      blockedRelays,
      options
    )
  )
}
