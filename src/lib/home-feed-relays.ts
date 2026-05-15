import { MAX_REQ_RELAY_URLS } from '@/constants'
import { feedRelayPolicyUrls } from '@/features/feed/relay-policy'
import { getHttpRelayListFromEvent, getRelayListReadFromEventNoFastFallback } from '@/lib/event-metadata'
import { getFavoritesFeedRelayUrls } from '@/lib/favorites-feed-relays'
import { AGGR_NOSTR_LAND_WSS } from '@/lib/nostr-land-aggr'
import { normalizeAnyRelayUrl } from '@/lib/url'
import { viewerUsesGlobalRelayDefaults } from '@/lib/viewer-relay-defaults'
import type { Event } from 'nostr-tools'

function relayUrlIsNostrLandAggr(url: string): boolean {
  const raw = url.trim()
  if (!raw) return false
  const normalized = (normalizeAnyRelayUrl(raw) || raw).toLowerCase()
  const aggrCanon = (normalizeAnyRelayUrl(AGGR_NOSTR_LAND_WSS) || AGGR_NOSTR_LAND_WSS).toLowerCase()
  if (normalized === aggrCanon) return true
  try {
    const u = new URL(normalized)
    return u.hostname.toLowerCase() === 'aggr.nostr.land'
  } catch {
    return /^wss:\/\/aggr\.nostr\.land\/?$/i.test(normalized)
  }
}

/** Drop nostr.land aggregate from REQ stacks where it must not appear (e.g. home feeds). */
export function stripNostrLandAggrFromRelayUrls(urls: readonly string[]): string[] {
  return urls.filter((url) => !relayUrlIsNostrLandAggr(url))
}

/**
 * Home “Lieblings-Relays” feed must never open timeline REQs to nostr.land’s aggregate relay (reserved for
 * threads / profiles / spells). Strips aggr from every shard after mapping, including trailing-slash variants.
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
