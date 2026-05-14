import { feedRelayPolicyUrls } from '@/features/feed/relay-policy'
import { getFavoritesFeedRelayUrls } from '@/lib/favorites-feed-relays'
import { AGGR_NOSTR_LAND_WSS } from '@/lib/nostr-land-aggr'
import { normalizeAnyRelayUrl } from '@/lib/url'

function relayUrlIsNostrLandAggr(url: string): boolean {
  const normalized = (normalizeAnyRelayUrl(url) || url.trim()).toLowerCase()
  const aggr = (normalizeAnyRelayUrl(AGGR_NOSTR_LAND_WSS) || AGGR_NOSTR_LAND_WSS).toLowerCase()
  return normalized === aggr
}

/** Drop nostr.land aggregate from REQ stacks where it must not appear (e.g. home feeds). */
export function stripNostrLandAggrFromRelayUrls(urls: readonly string[]): string[] {
  return urls.filter((url) => !relayUrlIsNostrLandAggr(url))
}

export function buildAllFavoritesFeedRelayUrls(
  favoriteRelays: string[],
  blockedRelays: string[],
  extraFeedRelayUrls: string[]
): string[] {
  return stripNostrLandAggrFromRelayUrls(
    feedRelayPolicyUrls(
      [
        { source: 'favorites', urls: getFavoritesFeedRelayUrls(favoriteRelays, blockedRelays) },
        { source: 'fallback', urls: extraFeedRelayUrls }
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
