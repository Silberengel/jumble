import { MAX_REQ_RELAY_URLS } from '@/constants'
import { feedRelayPolicyUrls } from '@/features/feed/relay-policy'
import { getHttpRelayListFromEvent, getRelayListReadFromEventNoFastFallback } from '@/lib/event-metadata'
import { getFavoritesFeedRelayUrls } from '@/lib/favorites-feed-relays'
import { stripNostrLandAggrFromRelayUrls } from '@/lib/nostr-land-relay-eligibility'
import { viewerUsesGlobalRelayDefaults } from '@/lib/viewer-relay-defaults'
import type { Event } from 'nostr-tools'

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
  return stripNostrLandAggrFromRelayUrls(
    feedRelayPolicyUrls(
      [
        {
          source: 'favorites',
          urls: getFavoritesFeedRelayUrls(favoriteRelays, blockedRelays, useGlobalFavoriteDefaults)
        },
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

/**
 * Relay pulse (sidebar active authors): only the viewer’s own stack — favorites (+ relay sets),
 * NIP-65 read, kind 10012 cache read, and HTTP index reads — never the global fast-read layer.
 */
export function buildRelayPulseQueryRelayUrls(options: {
  viewerPubkey: string | null | undefined
  favoriteRelayUrls: string[]
  blockedRelays: string[]
  relayList: { read?: string[]; httpRead?: string[] } | null | undefined
  cacheRelayListEvent: Event | null | undefined
  httpRelayListEvent: Event | null | undefined
}): string[] {
  const {
    viewerPubkey,
    favoriteRelayUrls,
    blockedRelays,
    relayList,
    cacheRelayListEvent,
    httpRelayListEvent
  } = options

  const useGlobalFavoriteDefaults = viewerUsesGlobalRelayDefaults({
    viewerPubkey,
    favoriteRelayUrls,
    relayList
  })
  const primaryRelays = getFavoritesFeedRelayUrls(favoriteRelayUrls, blockedRelays, useGlobalFavoriteDefaults)
  const inboxRelayUrls = relayList?.read?.length ? relayList.read : []

  const cacheRelayUrls: string[] = []
  if (cacheRelayListEvent) {
    cacheRelayUrls.push(...getRelayListReadFromEventNoFastFallback(cacheRelayListEvent, blockedRelays))
  }

  const httpRelayUrls: string[] = [...(relayList?.httpRead ?? [])]
  if (httpRelayListEvent) {
    httpRelayUrls.push(...getHttpRelayListFromEvent(httpRelayListEvent, blockedRelays).httpRead)
  }

  return stripNostrLandAggrFromRelayUrls(
    feedRelayPolicyUrls(
      [
        { source: 'favorites', urls: primaryRelays },
        { source: 'viewer-read', urls: inboxRelayUrls },
        { source: 'cache', urls: cacheRelayUrls },
        { source: 'http-index', urls: httpRelayUrls }
      ],
      {
        operation: 'read',
        blockedRelays,
        nostrLandAggr: 'never',
        applySocialKindBlockedFilter: false,
        allowThirdPartyLocalRelays: true,
        maxRelays: MAX_REQ_RELAY_URLS
      }
    )
  )
}
