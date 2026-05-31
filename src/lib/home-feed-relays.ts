import { feedRelayPolicyUrls } from '@/features/feed/relay-policy'
import { getFavoritesFeedRelayUrls } from '@/lib/favorites-feed-relays'
import { stripNostrLandAggrFromRelayUrls } from '@/lib/nostr-land-relay-eligibility'
import { isMetadataRelaysOnlyPolicyActive } from '@/lib/read-only-relay-personal'
import { isWispTrendingNotesRelayUrl } from '@/lib/wisp-trending-relay'

export { stripNostrLandAggrFromRelayUrls }

/**
 * Home timeline REQs (Notes, Replies, and Gallery tabs on `home-all-favorites`) must never hit aggr — only
 * favorites + Wisp trending (+ widened read layers on Replies/Gallery without aggr). Side-panel threads,
 * reply blurbs, backlinks, embeds, and profiles use {@link feedRelayPolicyUrls} / comprehensive lists instead.
 */
export function stripNostrLandAggrFromTimelineSubRequests<T extends { urls: string[] }>(
  feedSubscriptionKey: string | undefined,
  requests: readonly T[]
): T[] {
  if (feedSubscriptionKey !== 'home-all-favorites') {
    return requests.slice() as T[]
  }
  return requests.map((r) => ({
    ...r,
    urls: stripNostrLandAggrFromRelayUrls(r.urls)
  })) as T[]
}

export function buildAllFavoritesFeedRelayUrls(
  favoriteRelays: string[],
  blockedRelays: string[],
  extraFeedRelayUrls: string[],
  useGlobalFavoriteDefaults = true
): string[] {
  const extras = isMetadataRelaysOnlyPolicyActive()
    ? extraFeedRelayUrls.filter((u) => !isWispTrendingNotesRelayUrl(u))
    : extraFeedRelayUrls
  return stripNostrLandAggrFromRelayUrls(
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
  )
}
