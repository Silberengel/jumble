import {
  DEFAULT_FAVORITE_RELAYS,
  DOCUMENT_RELAY_URLS,
  FAST_READ_RELAY_URLS,
  PROFILE_RELAY_URLS,
  isDocumentRelayKind,
  relayFilterIncludesSocialKindBlockedKind
} from '@/constants'
import type { TFeedSubRequest } from '@/types'
import { normalizeAnyRelayUrl, normalizeUrl } from '@/lib/url'
import {
  buildPrioritizedReadRelayUrls,
  buildReadRelayPriorityLayers,
  dedupeNormalizeRelayUrlsOrdered,
  MAX_REQ_RELAY_URLS,
  relayUrlsLocalsFirst
} from '@/lib/relay-url-priority'
import { feedRelayPolicyUrls, type FeedRelayLayer } from '@/features/feed/relay-policy'
import { stripMailboxLocalUrlsForRemoteViewers } from '@/lib/relay-list-sanitize'
import { profileFetchRelayUrlsWithoutFastReadLayer } from '@/lib/viewer-relay-defaults'

const blockedSet = (blockedRelays: string[]) =>
  new Set(blockedRelays.map((b) => normalizeAnyRelayUrl(b) || b))

/**
 * Logged-in user’s favorite relays (kind 10012 `relay` tags via {@link useFavoriteRelays}, plus bootstrap defaults
 * when the event is missing): drop blocked, dedupe, normalize. If no non-blocked entries remain, use
 * {@link DEFAULT_FAVORITE_RELAYS} only when `useGlobalFavoriteDefaults` is true (signed-out or no NIP-65 and no favorites).
 * Same list drives the favorites tier in REQ/publish prioritization and the all-favorites home feed.
 */
/**
 * NIP-65 `read` plus HTTP index inboxes (kind 10243) for feed REQ / query URL lists.
 */
export function userReadRelaysWithHttp(
  relayList: { read?: string[]; httpRead?: string[] } | undefined | null
): string[] {
  const http = relayList?.httpRead ?? []
  const read = relayList?.read ?? []
  return dedupeNormalizeRelayUrlsOrdered([...http, ...read])
}

export function getFavoritesFeedRelayUrls(
  favoriteRelays: string[],
  blockedRelays: string[],
  useGlobalFavoriteDefaults = true
): string[] {
  const blocked = blockedSet(blockedRelays)
  const visible = favoriteRelays.filter((r) => {
    const k = normalizeAnyRelayUrl(r) || r
    return k && !blocked.has(k)
  })
  const base = visible.length > 0 ? visible : useGlobalFavoriteDefaults ? DEFAULT_FAVORITE_RELAYS : []
  return feedRelayPolicyUrls(
    [{ source: 'favorites', urls: base }],
    {
      operation: 'favorites-feed',
      blockedRelays,
      nostrLandAggr: 'never',
      applySocialKindBlockedFilter: false,
      allowThirdPartyLocalRelays: true
    }
  )
}

/**
 * Merge relay URL lists in order; first occurrence wins; drops blocked.
 */
export function mergeRelayUrlLayers(
  layers: readonly (readonly string[])[],
  blockedRelays: string[]
): string[] {
  const blocked = blockedSet(blockedRelays)
  const seen = new Set<string>()
  const out: string[] = []
  for (const layer of layers) {
    for (const u of layer) {
      const k = normalizeAnyRelayUrl(u) || u
      if (!k || blocked.has(k) || seen.has(k)) continue
      seen.add(k)
      out.push(k)
    }
  }
  return out
}

/**
 * Viewed author’s NIP-65 read list (inboxes), then write list (outboxes), each with LAN/local URLs first; blocked
 * stripped. Used for profile pins + Medien before {@link buildProfileAugmentedReadRelayUrls}.
 *
 * @param includeAuthorLocalRelays When true (viewing your own profile), keep LAN hints so local cache/outbox works.
 */
export function buildAuthorInboxOutboxRelayUrls(
  authorRelayList: { read: string[]; write: string[]; httpRead?: string[]; httpWrite?: string[] },
  blockedRelays: string[],
  includeAuthorLocalRelays = false
): string[] {
  const list = includeAuthorLocalRelays
    ? authorRelayList
    : stripMailboxLocalUrlsForRemoteViewers(authorRelayList)
  const inboxLayer = relayUrlsLocalsFirst([...(list.httpRead ?? []), ...(list.read ?? [])])
  const outboxLayer = relayUrlsLocalsFirst([...(list.httpWrite ?? []), ...(list.write ?? [])])
  return mergeRelayUrlLayers([inboxLayer, outboxLayer], blockedRelays)
}

/**
 * Profile pins + Medien: author NIP-65 tier (pass from {@link buildAuthorInboxOutboxRelayUrls}), then
 * {@link FAST_READ_RELAY_URLS}; dedupe, blocked-stripped, capped.
 */
const PROFILE_AUGMENTED_READ_MAX_RELAYS = 16

export function buildProfileAugmentedReadRelayUrls(
  authorRelayUrls: string[],
  blockedRelays: string[],
  maxRelays: number = PROFILE_AUGMENTED_READ_MAX_RELAYS,
  useGlobalRelayBootstrap = true
): string[] {
  const fastReadLayer =
    useGlobalRelayBootstrap
      ? (FAST_READ_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter(Boolean) as string[])
      : []
  const merged = mergeRelayUrlLayers(
    useGlobalRelayBootstrap ? [fastReadLayer, authorRelayUrls] : [authorRelayUrls, fastReadLayer],
    blockedRelays
  )
  return merged.slice(0, maxRelays)
}

/**
 * Another user's NIP-65 read/write lists can fill {@link PROFILE_PAGE_FEED_MAX_RELAYS} before the fast-read
 * tier is reached in {@link feedRelayPolicyUrls}, so kind 1 / 1111 REQs never hit relays that carry them.
 */
function pinFastReadForRemoteProfileFeed(
  urls: string[],
  fastReadLayer: readonly string[],
  blockedRelays: string[],
  maxRelays: number
): string[] {
  if (!fastReadLayer.length) return urls.slice(0, maxRelays)
  return mergeRelayUrlLayers([fastReadLayer, urls], blockedRelays).slice(0, maxRelays)
}

export type ReadRelayPriorityOptions = {
  /** User NIP-65 write list — local URLs are promoted with inboxes for REQ. */
  userWriteRelays?: string[]
  /** Profile/timeline author outboxes (write relays) when known. */
  authorWriteRelays?: string[]
  maxRelays?: number
  /**
   * When set, applies to all subrequests. When unset, each subrequest uses
   * {@link relayFilterIncludesSocialKindBlockedKind} on its filter to decide whether to strip
   * relays in `SOCIAL_KIND_BLOCKED_RELAY_URLS` before capping.
   */
  applySocialKindBlockedFilter?: boolean
  /**
   * When false, empty favorites do not fall back to {@link DEFAULT_FAVORITE_RELAYS}. Default true.
   */
  useGlobalFavoriteDefaults?: boolean
  /** When false, omit the global FAST_READ tier. Default true. */
  includeGlobalFastRead?: boolean
}

/**
 * REQ order: user inboxes + locals → author outboxes → favorites → {@link FAST_READ_RELAY_URLS}.
 */
export function getRelayUrlsWithFavoritesFastReadAndInbox(
  favoriteRelays: string[],
  blockedRelays: string[],
  userInboxReadRelays: string[],
  options?: ReadRelayPriorityOptions
): string[] {
  const useFavDefaults = options?.useGlobalFavoriteDefaults !== false
  const includeFast = options?.includeGlobalFastRead !== false
  const favorites = getFavoritesFeedRelayUrls(favoriteRelays, blockedRelays, useFavDefaults)
  return buildPrioritizedReadRelayUrls({
    userReadRelays: userInboxReadRelays,
    userWriteRelays: options?.userWriteRelays ?? [],
    authorWriteRelays: options?.authorWriteRelays ?? [],
    favoriteRelays: favorites,
    blockedRelays,
    maxRelays: options?.maxRelays,
    applySocialKindBlockedFilter: options?.applySocialKindBlockedFilter,
    includeGlobalFastRead: includeFast
  })
}

/**
 * Profile page pins + feed: viewed author's NIP-65 read + write (REQ tier 1), then logged-in user's favorites,
 * then fast-read defaults from constants, deduped and blocked-stripped, capped at this count.
 */
/** Profile REQ cap: too small waits on a few bad relays; larger spreads load across fast-read / favorites. */
const PROFILE_PAGE_FEED_MAX_RELAYS = 14

/** Long-form / publication profile tab: slightly larger cap + {@link DOCUMENT_RELAY_URLS} merge. */
const PROFILE_PAGE_DOCUMENT_FEED_MAX_RELAYS = 24

export const PROFILE_PAGE_PINS_RESOLVE_LIMIT = 10

export function buildProfilePageReadRelayUrls(
  favoriteRelays: string[],
  blockedRelays: string[],
  authorRelayList: { read: string[]; write: string[]; httpRead?: string[]; httpWrite?: string[] },
  kindsIncludeSocialBlockedKind: boolean,
  includeAuthorLocalRelays = false,
  /** When the timeline includes document kinds (30023, 30040, …), add document index relays and raise the cap. */
  profileKindsHint?: readonly number[],
  /** When false, omit global FAST_READ / profile-fetch widening for logged-in users with their own relay stack. */
  useGlobalRelayBootstrap?: boolean
): string[] {
  const useGlobal = useGlobalRelayBootstrap !== false
  const wantsDocumentLayer = profileKindsHint?.some((k) => isDocumentRelayKind(k)) ?? false
  const maxRelays = wantsDocumentLayer ? PROFILE_PAGE_DOCUMENT_FEED_MAX_RELAYS : PROFILE_PAGE_FEED_MAX_RELAYS
  const list = includeAuthorLocalRelays
    ? authorRelayList
    : stripMailboxLocalUrlsForRemoteViewers(authorRelayList)
  const authorRead = [...(list.httpRead ?? []), ...(list.read ?? [])]
  const authorWrite = [...(list.httpWrite ?? []), ...(list.write ?? [])]
  const authorHasNoNip65 = authorRead.length === 0 && authorWrite.length === 0

  const favorites = getFavoritesFeedRelayUrls(favoriteRelays, blockedRelays, useGlobal)
  const fastReadLayer = useGlobal
    ? (FAST_READ_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter(Boolean) as string[])
    : []
  const authorWriteLayer = relayUrlsLocalsFirst(authorWrite)
  const authorReadLayer = relayUrlsLocalsFirst(authorRead)
  const urls = feedRelayPolicyUrls(
    [
      { source: 'author-write', urls: authorWriteLayer },
      { source: 'author-read', urls: authorReadLayer },
      { source: 'favorites', urls: favorites },
      { source: 'fast-read', urls: fastReadLayer }
    ],
    {
      operation: 'read',
      blockedRelays,
      maxRelays,
      applySocialKindBlockedFilter: kindsIncludeSocialBlockedKind,
      socialKindBlockedExemptRelays: [...authorWriteLayer, ...authorReadLayer],
      allowThirdPartyLocalRelays: true
    }
  )
  const pinFastReadForRemote = useGlobal && !includeAuthorLocalRelays

  /** Authors without kind 10002: widen REQ targets so notes/metadata are still discoverable on index relays. */
  if (authorHasNoNip65) {
    const profileSource = useGlobal ? PROFILE_RELAY_URLS : profileFetchRelayUrlsWithoutFastReadLayer()
    const profileFetchLayer = profileSource.map((u) => normalizeUrl(u) || u).filter(Boolean) as string[]
    const cap = maxRelays + 8
    const merged = mergeRelayUrlLayers([urls, profileFetchLayer], blockedRelays).slice(0, cap)
    return pinFastReadForRemote
      ? pinFastReadForRemoteProfileFeed(merged, fastReadLayer, blockedRelays, cap)
      : merged
  }
  if (wantsDocumentLayer) {
    const docLayer = DOCUMENT_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter(Boolean) as string[]
    const cap = maxRelays + 6
    const merged = mergeRelayUrlLayers([urls, docLayer], blockedRelays).slice(0, cap)
    return pinFastReadForRemote
      ? pinFastReadForRemoteProfileFeed(merged, fastReadLayer, blockedRelays, cap)
      : merged
  }
  return pinFastReadForRemote
    ? pinFastReadForRemoteProfileFeed(urls, fastReadLayer, blockedRelays, maxRelays)
    : urls
}

/**
 * Per subrequest: shared inbox → author/favorites → fast read stack, normalized, user-blocked and (when applicable)
 * social-kind-blocked stripped, deduped, capped. Subrequest `urls` are prepended first so explicit shard hints win.
 */
export function augmentSubRequestsWithFavoritesFastReadAndInbox(
  requests: TFeedSubRequest[],
  favoriteRelays: string[],
  blockedRelays: string[],
  userInboxReadRelays: string[],
  options?: ReadRelayPriorityOptions
): TFeedSubRequest[] {
  const max = options?.maxRelays ?? MAX_REQ_RELAY_URLS
  const userReadSocialExempt = new Set<string>()
  for (const u of userInboxReadRelays) {
    const n = normalizeAnyRelayUrl(u) || u.trim()
    if (n) userReadSocialExempt.add(n)
  }
  return requests.map((r) => {
    const applySocial =
      options?.applySocialKindBlockedFilter !== undefined
        ? options.applySocialKindBlockedFilter
        : relayFilterIncludesSocialKindBlockedKind(r.filter)

    const useFavDefaults = options?.useGlobalFavoriteDefaults !== false
    const includeFast = options?.includeGlobalFastRead !== false
    const favorites = getFavoritesFeedRelayUrls(favoriteRelays, blockedRelays, useFavDefaults)

    const authorOnly = dedupeNormalizeRelayUrlsOrdered(options?.authorWriteRelays ?? [])

    const coreLayers = buildReadRelayPriorityLayers({
      userReadRelays: userInboxReadRelays,
      userWriteRelays: options?.userWriteRelays ?? [],
      authorWriteRelays: authorOnly,
      favoriteRelays: favorites,
      includeGlobalFastRead: includeFast
    })

    const layers = [relayUrlsLocalsFirst(r.urls), ...coreLayers]

    const policyLayers: FeedRelayLayer[] = layers.map((urls, index) => ({
      source: index === 0 ? 'explicit' : index === 1 ? 'viewer-read' : 'fallback',
      urls
    }))
    return {
      ...r,
      urls: feedRelayPolicyUrls(policyLayers, {
        operation: 'read',
        blockedRelays,
        maxRelays: max,
        applySocialKindBlockedFilter: applySocial,
        socialKindBlockedExemptRelays: [...userReadSocialExempt],
        allowThirdPartyLocalRelays: true
      })
    }
  })
}
