/**
 * Comprehensive relay list builder utility
 * Handles all relay selection requirements:
 * - Filters blocked relays
 * - Includes local relays from kind 10432
 * - Handles author's outboxes/inboxes
 * - Handles user's outboxes/inboxes
 * - Includes relay hints
 * - Includes seen relays
 */

import { FAST_READ_RELAY_URLS, PROFILE_RELAY_URLS, SEARCHABLE_RELAY_URLS } from '@/constants'
import { feedRelayPolicyUrls } from '@/features/feed/relay-policy'
import { mergeRelayUrlLayers, userReadRelaysWithHttp } from '@/lib/favorites-feed-relays'
import { urlIsNonLocalForRemoteViewer } from '@/lib/relay-list-sanitize'
import { isHttpRelayUrl, normalizeAnyRelayUrl, normalizeUrl } from '@/lib/url'
import { buildPersonalRelayKeySet, sanitizeRelayUrlsForFetch } from '@/lib/read-only-relay-personal'
import { getCacheRelayUrls } from './private-relays'
import { defaultFavoriteRelaysForViewer, viewerUsesGlobalRelayDefaults } from '@/lib/viewer-relay-defaults'
import client from '@/services/client.service'
import logger from '@/lib/logger'
import type { Event } from 'nostr-tools'

/** Max author NIP-65 read / write URLs merged into comprehensive read lists (shared with viewer first). */
export const AUTHOR_NIP65_RELAY_CAP = 2

function relayKey(url: string): string {
  return (normalizeAnyRelayUrl(url) || url.trim()).toLowerCase()
}

/**
 * Up to `max` author relays, preferring URLs that also appear on the viewer's NIP-65 read/write lists.
 */
export function pickAuthorNip65RelaysPreferringViewerOverlap(
  authorUrls: readonly string[],
  viewerUrls: readonly string[],
  max: number
): string[] {
  if (max <= 0) return []
  const viewerKeys = new Set(viewerUrls.map(relayKey).filter(Boolean))
  const shared: string[] = []
  const authorOnly: string[] = []
  const seen = new Set<string>()
  for (const raw of authorUrls) {
    const k = relayKey(raw)
    if (!k || seen.has(k)) continue
    seen.add(k)
    if (viewerKeys.has(k)) shared.push(normalizeAnyRelayUrl(raw) || raw.trim())
    else authorOnly.push(normalizeAnyRelayUrl(raw) || raw.trim())
  }
  const out: string[] = []
  const push = (u: string) => {
    const k = relayKey(u)
    if (!k || out.some((x) => relayKey(x) === k)) return
    out.push(u)
  }
  for (const u of [...shared, ...authorOnly]) {
    if (out.length >= max) break
    push(u)
  }
  return out
}

function dedupeNormalizedRelayUrls(urls: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of urls) {
    if (isHttpRelayUrl(u)) continue
    const n = normalizeAnyRelayUrl(u) || u.trim()
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

/**
 * Relays to bootstrap Explore replaceable fetches (e.g. kind 10012 batch) before NIP-65 resolves.
 * PROFILE_FETCH + FAST_READ.
 */
function exploreDiscoveryBootstrapRelayUrls(): string[] {
  return dedupeNormalizedRelayUrls([...PROFILE_RELAY_URLS, ...FAST_READ_RELAY_URLS])
}

export interface RelayListBuilderOptions {
  /** Author's pubkey - will include their outboxes (write relays) */
  authorPubkey?: string
  /** Logged-in user's pubkey - will include their inboxes (read relays) and outboxes (write relays) */
  userPubkey?: string
  /** Explicit relay hints (from bech32 IDs or event tags) */
  relayHints?: string[]
  /** Relays where an event was seen */
  seenRelays?: string[]
  /** Relays where a containing event was found (for embedded events) */
  containingEventRelays?: string[]
  /** Whether to include user's own relays (read/write/local) - for profiles/metadata */
  includeUserOwnRelays?: boolean
  /** Whether to include PROFILE_RELAY_URLS - for profiles/metadata */
  includeProfileFetchRelays?: boolean
  /** Whether to include FAST_READ_RELAY_URLS as fallback */
  includeFastReadRelays?: boolean
  /**
   * Legacy name: adds {@link FAST_READ_RELAY_URLS} as extra bootstrap mirrors for REQ/read lists
   * (historically mis-tagged as “fast write”).
   */
  includeFastWriteRelays?: boolean
  /** Whether to include SEARCHABLE_RELAY_URLS - for search */
  includeSearchableRelays?: boolean
  /** Blocked relays to filter out */
  blockedRelays?: string[]
  /** Whether to include local relays from kind 10432 */
  includeLocalRelays?: boolean
  /** Whether to include user's favorite relays (kind 10012) */
  includeFavoriteRelays?: boolean
  /**
   * When true with fast-read / searchable / profile-fetch includes: insert `PROFILE_RELAY_URLS`,
   * `FAST_READ_RELAY_URLS`, and `SEARCHABLE_RELAY_URLS` immediately after hints/seen/containing and **before**
   * author + user NIP-65 lists. Used for batched metadata and embed fetches so public mirrors are not queued
   * behind broken personal relays under the global connection cap.
   */
  preferPublicReadRelaysEarly?: boolean
  /**
   * When set, skips {@link viewerUsesGlobalRelayDefaults} and forces fast-read bootstrap on/off.
   * Otherwise fast-read is omitted for logged-in users who have favorites or NIP-65 configured.
   */
  useGlobalRelayDefaults?: boolean
  /** Append the viewer's kind 10243 HTTP index relays when present (not subject to WS-only `addRelay`). */
  includeViewerHttpIndexRelays?: boolean
}

/**
 * Build comprehensive relay list according to requirements
 */
export async function buildComprehensiveRelayList(options: RelayListBuilderOptions = {}): Promise<string[]> {
  const {
    authorPubkey,
    userPubkey,
    relayHints = [],
    seenRelays = [],
    containingEventRelays = [],
    includeUserOwnRelays = false,
    includeProfileFetchRelays = false,
    includeFastReadRelays = true,
    includeFastWriteRelays = false,
    includeSearchableRelays = false,
    blockedRelays = [],
    includeLocalRelays = true,
    includeFavoriteRelays = false,
    preferPublicReadRelaysEarly = false,
    useGlobalRelayDefaults: useGlobalRelayDefaultsOption,
    includeViewerHttpIndexRelays = true
  } = options

  const relayUrls = new Set<string>()
  const httpRelayUrls: string[] = []
  /** NIP-65 / favorites / 10432 — read-only index relays are only kept when listed here. */
  const personalRelayUrls: string[] = []
  const trackPersonal = (url: string) => {
    personalRelayUrls.push(url)
  }
  const normalizedBlocked = new Set(
    (blockedRelays || [])
      .map((url) => (normalizeAnyRelayUrl(url) || url).toLowerCase())
      .filter(Boolean)
  )

  const addRelay = (url: string | undefined) => {
    if (!url) return
    // This builder feeds WebSocket REQ/publish lists; keep HTTP relays separate.
    if (isHttpRelayUrl(url)) return
    const normalized = normalizeAnyRelayUrl(url)
    if (!normalized) return
    // Filter blocked (case-insensitive comparison)
    if (normalizedBlocked.has(normalized.toLowerCase())) return
    relayUrls.add(normalized)
  }

  /** Hints / NIP-65 lists — no loopback/LAN (viewer cache relays come from kind 10432 only). */
  const addRelayFromHints = (url: string | undefined) => {
    if (!url || !urlIsNonLocalForRemoteViewer(url)) return
    addRelay(url)
  }

  const addHttpRelay = (url: string | undefined) => {
    if (!url || !isHttpRelayUrl(url)) return
    const normalized = normalizeAnyRelayUrl(url) || url.trim()
    if (!normalized || normalizedBlocked.has(normalized.toLowerCase())) return
    if (httpRelayUrls.some((u) => relayKey(u) === relayKey(normalized))) return
    httpRelayUrls.push(normalized)
  }

  let viewerRelayListForShare: { read?: string[]; write?: string[]; httpRead?: string[]; httpWrite?: string[] } | null =
    null
  if (userPubkey) {
    try {
      viewerRelayListForShare = await client.peekRelayListFromStorage(userPubkey)
    } catch {
      viewerRelayListForShare = null
    }
  }
  const viewerWsForAuthorOverlap = [
    ...(viewerRelayListForShare?.read ?? []),
    ...(viewerRelayListForShare?.write ?? [])
  ]

  let effectiveIncludeFastRead = includeFastReadRelays
  if (userPubkey && includeFastReadRelays) {
    if (useGlobalRelayDefaultsOption !== undefined) {
      effectiveIncludeFastRead = useGlobalRelayDefaultsOption
    } else {
      try {
        const fav =
          includeFavoriteRelays && userPubkey
            ? await client.fetchFavoriteRelays(userPubkey).catch(() => [] as string[])
            : []
        effectiveIncludeFastRead = viewerUsesGlobalRelayDefaults({
          viewerPubkey: userPubkey,
          favoriteRelayUrls: fav,
          relayList: viewerRelayListForShare ?? undefined
        })
      } catch {
        effectiveIncludeFastRead = true
      }
    }
  }

  // 1. Relay hints (highest priority - explicit hints)
  relayHints.filter(urlIsNonLocalForRemoteViewer).forEach(addRelayFromHints)

  // 2. Relays where event was seen
  seenRelays.filter(urlIsNonLocalForRemoteViewer).forEach(addRelayFromHints)

  // 3. Relays where containing event was found (for embedded events)
  containingEventRelays.filter(urlIsNonLocalForRemoteViewer).forEach(addRelayFromHints)

  // 3b. Public profile / read relays before user favorites & NIP-65 (batched kind-0 — avoids burning
  // connection slots on broken personal relays before PROFILE_FETCH + FAST_READ answer).
  if (preferPublicReadRelaysEarly) {
    if (includeProfileFetchRelays) {
      PROFILE_RELAY_URLS.forEach(addRelay)
    }
    if (effectiveIncludeFastRead) {
      FAST_READ_RELAY_URLS.forEach(addRelay)
    }
    if (includeSearchableRelays) {
      SEARCHABLE_RELAY_URLS.forEach(addRelay)
    }
  }

  // 4. Author's outboxes (write relays) - where they publish (IndexedDB + defaults; no network gate)
  if (authorPubkey) {
    try {
      const authorRelayList = await client.peekRelayListFromStorage(authorPubkey)
      pickAuthorNip65RelaysPreferringViewerOverlap(
        (authorRelayList.write ?? []).filter(urlIsNonLocalForRemoteViewer),
        viewerWsForAuthorOverlap,
        AUTHOR_NIP65_RELAY_CAP
      ).forEach(addRelayFromHints)
      pickAuthorNip65RelaysPreferringViewerOverlap(
        (authorRelayList.read ?? []).filter(urlIsNonLocalForRemoteViewer),
        viewerWsForAuthorOverlap,
        AUTHOR_NIP65_RELAY_CAP
      ).forEach(addRelayFromHints)
    } catch (error) {
      logger.warn('[RelayListBuilder] Failed to read author relay list from storage', { error })
    }
  }

  // 5. User's own relays (for profiles/metadata)
  if (includeUserOwnRelays && userPubkey) {
    try {
      const userRelayList = viewerRelayListForShare ?? (await client.peekRelayListFromStorage(userPubkey))
      const userRead = userReadRelaysWithHttp(userRelayList).slice(0, 10)
      const userWrite = [...(userRelayList.write || []).slice(0, 10)]
      userRead.filter(urlIsNonLocalForRemoteViewer).forEach((u) => {
        trackPersonal(u)
        addRelayFromHints(u)
      })
      userWrite.filter(urlIsNonLocalForRemoteViewer).forEach((u) => {
        trackPersonal(u)
        addRelayFromHints(u)
      })

      // Include local relays from kind 10432
      if (includeLocalRelays) {
        const localRelays = await getCacheRelayUrls(userPubkey)
        localRelays.forEach((u) => {
          trackPersonal(u)
          addRelay(u)
        })
      }
      
      // Include favorite relays (kind 10012) if requested
      if (includeFavoriteRelays) {
        try {
          const favoriteRelays = await client.fetchFavoriteRelays(userPubkey)
          favoriteRelays.forEach((u) => {
            trackPersonal(u)
            addRelay(u)
          })
        } catch (error) {
          logger.warn('[RelayListBuilder] Failed to fetch user favorite relays', { error })
        }
      }
    } catch (error) {
      logger.warn('[RelayListBuilder] Failed to fetch user relay list', { error })
    }
  } else if (userPubkey) {
    // Even if not including user's own relays, still include user's inboxes for reading
    try {
      const userRelayList = viewerRelayListForShare ?? (await client.peekRelayListFromStorage(userPubkey))
      ;(userRelayList.read ?? [])
        .slice(0, 10)
        .filter(urlIsNonLocalForRemoteViewer)
        .forEach((u) => {
          trackPersonal(u)
          addRelayFromHints(u)
        })

      // Include local relays from kind 10432 if enabled
      if (includeLocalRelays) {
        const localRelays = await getCacheRelayUrls(userPubkey)
        localRelays.forEach((u) => {
          trackPersonal(u)
          addRelay(u)
        })
      }
      // Menu / feed “favorite relays” (kind 10012) — same list as the sidebar; not part of NIP-65 alone.
      if (includeFavoriteRelays) {
        try {
          const favoriteRelays = await client.fetchFavoriteRelays(userPubkey)
          favoriteRelays.forEach((u) => {
            trackPersonal(u)
            addRelay(u)
          })
        } catch (error) {
          logger.warn('[RelayListBuilder] Failed to fetch user favorite relays', { error })
        }
      }
    } catch (error) {
      logger.warn('[RelayListBuilder] Failed to fetch user inboxes', { error })
    }
  }

  // 6. Profile fetch relays (for profiles/metadata)
  if (includeProfileFetchRelays) {
    PROFILE_RELAY_URLS.forEach(addRelay)
  }

  // 7. Fast read relays (fallback)
  if (effectiveIncludeFastRead && !preferPublicReadRelaysEarly) {
    FAST_READ_RELAY_URLS.forEach(addRelay)
  }

  // 8. Extra fast-read bootstrap mirrors (call sites use legacy `includeFastWriteRelays`)
  if (includeFastWriteRelays && effectiveIncludeFastRead) {
    FAST_READ_RELAY_URLS.forEach(addRelay)
  }

  // 9. Searchable relays (for search)
  if (includeSearchableRelays && !preferPublicReadRelaysEarly) {
    SEARCHABLE_RELAY_URLS.forEach(addRelay)
  }

  if (includeViewerHttpIndexRelays && userPubkey && viewerRelayListForShare) {
    const hasHttp =
      (viewerRelayListForShare.httpRead?.length ?? 0) > 0 ||
      (viewerRelayListForShare.httpWrite?.length ?? 0) > 0
    if (hasHttp) {
      ;[...(viewerRelayListForShare.httpRead ?? []), ...(viewerRelayListForShare.httpWrite ?? [])].forEach(
        addHttpRelay
      )
    }
  }

  const merged = Array.from(relayUrls)
  const personalKeys = userPubkey ? buildPersonalRelayKeySet(personalRelayUrls) : undefined
  const ws = sanitizeRelayUrlsForFetch(
    feedRelayPolicyUrls([{ source: 'fallback', urls: merged }], {
      operation: 'read',
      blockedRelays,
      applySocialKindBlockedFilter: false,
      allowThirdPartyLocalRelays: false
    }),
    personalKeys
  )
  if (httpRelayUrls.length === 0) return ws
  const seen = new Set(ws.map(relayKey))
  const out = [...ws]
  for (const u of httpRelayUrls) {
    const k = relayKey(u)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(u)
  }
  return out
}

/**
 * Batched kind-0 / profile hydration: {@link PROFILE_RELAY_URLS} plus the logged-in viewer's own relays only.
 */
export async function buildProfileAndUserRelayList(
  userPubkey: string | null | undefined,
  blockedRelays: string[] = []
): Promise<string[]> {
  const profileWs = dedupeNormalizedRelayUrls([...PROFILE_RELAY_URLS])
  if (!userPubkey?.trim()) {
    return feedRelayPolicyUrls([{ source: 'profile-fetch', urls: profileWs }], {
      operation: 'read',
      blockedRelays,
      applySocialKindBlockedFilter: false,
      allowThirdPartyLocalRelays: true
    })
  }
  const userStack = await buildComprehensiveRelayList({
    userPubkey,
    includeUserOwnRelays: true,
    includeProfileFetchRelays: false,
    includeFastReadRelays: false,
    includeFastWriteRelays: false,
    includeSearchableRelays: false,
    includeFavoriteRelays: true,
    includeLocalRelays: true,
    includeViewerHttpIndexRelays: true,
    blockedRelays
  })
  const httpPart = userStack.filter((u) => isHttpRelayUrl(u))
  const wsPart = userStack.filter((u) => !isHttpRelayUrl(u))
  const seen = new Set<string>()
  const mergedWs: string[] = []
  for (const u of [...profileWs, ...wsPart]) {
    const k = relayKey(u)
    if (!k || seen.has(k)) continue
    seen.add(k)
    mergedWs.push(u)
  }
  const policyWs = feedRelayPolicyUrls([{ source: 'profile-fetch', urls: mergedWs }], {
    operation: 'read',
    blockedRelays,
    applySocialKindBlockedFilter: false,
    allowThirdPartyLocalRelays: true
  })
  const outSeen = new Set(policyWs.map(relayKey))
  const out = [...policyWs]
  for (const u of httpPart) {
    const k = relayKey(u)
    if (!k || outSeen.has(k)) continue
    outSeen.add(k)
    out.push(u)
  }
  return out
}

/**
 * Explore: Following's Favorites (kind 10012 batch) / replaceable discovery.
 * Bootstrap relays (profile + FAST_READ) plus the viewer's read/write and cache (10432) when logged in.
 */
export async function buildExploreProfileAndUserRelayList(
  userPubkey: string | null | undefined
): Promise<string[]> {
  const boot = exploreDiscoveryBootstrapRelayUrls()
  if (!userPubkey) {
    return boot
  }
  let useGlobal = true
  try {
    const [fav, peeked] = await Promise.all([
      client.fetchFavoriteRelays(userPubkey).catch(() => [] as string[]),
      client.peekRelayListFromStorage(userPubkey).catch(() => null)
    ])
    useGlobal = viewerUsesGlobalRelayDefaults({
      viewerPubkey: userPubkey,
      favoriteRelayUrls: fav,
      relayList: peeked ?? undefined
    })
  } catch {
    useGlobal = true
  }
  try {
    const built = await buildComprehensiveRelayList({
      userPubkey,
      includeUserOwnRelays: true,
      includeProfileFetchRelays: true,
      includeFastReadRelays: useGlobal,
      includeFavoriteRelays: false,
      includeLocalRelays: true,
      includeFastWriteRelays: false,
      includeSearchableRelays: false
    })
    if (!useGlobal) {
      return built
    }
    if (!built.length) return boot
    return dedupeNormalizedRelayUrls([...boot, ...built])
  } catch {
    return useGlobal ? boot : []
  }
}

/** NIP-10 relay hints from `e` / `E` tags (third value) on the focused event or thread. Omits loopback/LAN — those are only meaningful on the tag author's machine. */
export function relayHintsFromEventTags(event: { tags: string[][] }): string[] {
  const out = new Set<string>()
  for (const tag of event.tags) {
    if ((tag[0] === 'e' || tag[0] === 'E') && tag[2]) {
      const n = normalizeUrl(tag[2]) || tag[2]
      if (n && urlIsNonLocalForRemoteViewer(n)) out.add(n)
    }
  }
  return [...out]
}

const POLL_RESULTS_MAX_RELAYS = 40
const POLL_RESULTS_NIP65_READ_SLICE = 16

/**
 * Relays to REQ poll responses (kind 1068 replies), in priority order:
 * seen relays, NIP-10 `e`/`E` hints, poll `relay` tags, viewer NIP-65 **read** (inbox),
 * favorite relays (kind 10012 from props), viewer cache relays (10432), {@link FAST_READ_RELAY_URLS},
 * poll author NIP-65 **read** (inbox).
 */
export async function buildPollResultsReadRelayUrls(options: {
  pollEvent: Event
  pollRelayUrls: string[]
  viewerPubkey: string | null | undefined
  /** From {@link useFavoriteRelays} — avoids a second kind 10012 fetch. */
  viewerFavoriteRelayUrls?: string[]
  blockedRelays?: string[]
}): Promise<string[]> {
  const {
    pollEvent,
    pollRelayUrls,
    viewerPubkey,
    viewerFavoriteRelayUrls = [],
    blockedRelays = []
  } = options

  const normalizedBlocked = new Set(
    blockedRelays
      .map((url) => (normalizeAnyRelayUrl(url) || url).toLowerCase())
      .filter(Boolean)
  )

  const ordered: string[] = []
  const seenNorm = new Set<string>()

  const pushLayer = (urls: string[]) => {
    for (const raw of urls) {
      if (isHttpRelayUrl(raw)) continue
      const normalized = normalizeUrl(raw) || raw?.trim()
      if (!normalized || normalizedBlocked.has(normalized.toLowerCase())) continue
      if (seenNorm.has(normalized)) continue
      seenNorm.add(normalized)
      ordered.push(normalized)
    }
  }

  pushLayer(client.getSeenEventRelayUrls(pollEvent.id))
  pushLayer(relayHintsFromEventTags(pollEvent))
  pushLayer(pollRelayUrls)

  let authorReadSlice: string[] = []
  let viewerReadSlice: string[] = []
  let useGlobalFastRead = true
  try {
    const [authorRl, viewerRl] = await Promise.all([
      pollEvent.pubkey ? client.peekRelayListFromStorage(pollEvent.pubkey) : Promise.resolve(null),
      viewerPubkey ? client.peekRelayListFromStorage(viewerPubkey) : Promise.resolve(null)
    ])
    if (authorRl) {
      authorReadSlice = userReadRelaysWithHttp(authorRl).slice(0, POLL_RESULTS_NIP65_READ_SLICE)
    }
    if (viewerRl) {
      viewerReadSlice = userReadRelaysWithHttp(viewerRl).slice(0, POLL_RESULTS_NIP65_READ_SLICE)
      useGlobalFastRead = viewerUsesGlobalRelayDefaults({
        viewerPubkey,
        favoriteRelayUrls: viewerFavoriteRelayUrls,
        relayList: viewerRl
      })
    }
  } catch {
    /* ignore — poll results still use other layers */
  }

  pushLayer(viewerReadSlice)

  if (viewerPubkey) {
    pushLayer(viewerFavoriteRelayUrls)
    try {
      const localRelays = await getCacheRelayUrls(viewerPubkey)
      pushLayer(localRelays)
    } catch {
      /* ignore */
    }
  }

  if (useGlobalFastRead) {
    pushLayer([...FAST_READ_RELAY_URLS])
  }
  pushLayer(authorReadSlice)

  return feedRelayPolicyUrls([{ source: 'fallback', urls: ordered }], {
    operation: 'read',
    blockedRelays,
    maxRelays: POLL_RESULTS_MAX_RELAYS,
    applySocialKindBlockedFilter: false,
    allowThirdPartyLocalRelays: true
  })
}

/**
 * Build relay list for reading replies/comments: thread hints, author/user NIP-65, favorites, cache —
 * then default favorite relays only when global bootstrap applies (signed-out or no configured stack).
 */
export type BuildReplyReadRelayListOptions = {
  /** When true (e.g. Explore single-relay page), query only thread hints + author/user NIP-65 — no favorite/fast-read bootstrap layer. */
  relayAuthoritative?: boolean
}

export async function buildReplyReadRelayList(
  opAuthorPubkey: string | undefined,
  userPubkey: string | undefined,
  blockedRelays: string[] = [],
  threadRelayHints: string[] = [],
  options?: BuildReplyReadRelayListOptions
): Promise<string[]> {
  if (options?.relayAuthoritative) {
    const scoped = await buildComprehensiveRelayList({
      authorPubkey: opAuthorPubkey,
      userPubkey,
      relayHints: threadRelayHints,
      includeUserOwnRelays: Boolean(userPubkey),
      includeFastReadRelays: false,
      useGlobalRelayDefaults: false,
      includeSearchableRelays: false,
      includeLocalRelays: true,
      includeFavoriteRelays: false,
      preferPublicReadRelaysEarly: false,
      includeProfileFetchRelays: false,
      blockedRelays
    })
    return scoped
  }

  let useGlobal = true
  if (userPubkey) {
    try {
      const [fav, rl] = await Promise.all([
        client.fetchFavoriteRelays(userPubkey).catch(() => [] as string[]),
        client.peekRelayListFromStorage(userPubkey)
      ])
      useGlobal = viewerUsesGlobalRelayDefaults({
        viewerPubkey: userPubkey,
        favoriteRelayUrls: fav,
        relayList: rl ?? undefined
      })
    } catch {
      useGlobal = true
    }
  }
  const scoped = await buildComprehensiveRelayList({
    authorPubkey: opAuthorPubkey,
    userPubkey,
    relayHints: threadRelayHints,
    includeUserOwnRelays: Boolean(userPubkey),
    includeFastReadRelays: useGlobal,
    useGlobalRelayDefaults: useGlobal,
    includeSearchableRelays: false,
    includeLocalRelays: true,
    includeFavoriteRelays: Boolean(userPubkey),
    preferPublicReadRelaysEarly: false,
    includeProfileFetchRelays: useGlobal,
    blockedRelays
  })
  return mergeRelayUrlLayers([scoped, defaultFavoriteRelaysForViewer(useGlobal)], blockedRelays)
}
