import {
  FAST_READ_RELAY_URLS,
  FAST_WRITE_RELAY_URLS,
  MAX_CONCURRENT_RELAY_CONNECTIONS,
  MAX_PUBLISH_RELAYS
} from '@/constants'
import { feedRelayPolicyUrls, type FeedRelayLayer } from '@/features/feed/relay-policy'
import {
  isLocalNetworkUrl,
  isValidRelayFetchUrl,
  normalizeAnyRelayUrl,
  normalizeRelayUrlByScheme,
  normalizeUrl
} from '@/lib/url'

export function dedupeNormalizeRelayUrlsOrdered(urls: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of urls) {
    if (!isValidRelayFetchUrl(u)) continue
    const n = normalizeRelayUrlByScheme(u)
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

import { filterContextAuthorReadRelaysForPublish as stripNonInboxPublishHints } from '@/lib/relay-publish-filter'

/**
 * NIP-65 **read** (inbox) hints from reply/mention context must never add LAN, loopback, Tor-only,
 * read-only aggregators, or profile/index mirrors to the publish list.
 */
export function filterContextAuthorReadRelaysForPublish(urls: string[]): string[] {
  const reachable = dedupeNormalizeRelayUrlsOrdered(urls).filter((u) => {
    const n = normalizeAnyRelayUrl(u) || u.trim()
    if (!n) return false
    if (isLocalNetworkUrl(u) || isLocalNetworkUrl(n)) return false
    try {
      const host = new URL(n).hostname
      if (host.endsWith('.onion')) return false
    } catch {
      return false
    }
    return true
  })
  return dedupeNormalizeRelayUrlsOrdered(stripNonInboxPublishHints(reachable))
}

/** LAN / local host relays first, then the rest; deduped. */
export function relayUrlsLocalsFirst(urls: string[]): string[] {
  const local: string[] = []
  const remote: string[] = []
  for (const u of urls) {
    const n = normalizeAnyRelayUrl(u) || u.trim()
    if (!n) continue
    if (isLocalNetworkUrl(u) || isLocalNetworkUrl(n)) local.push(n)
    else remote.push(n)
  }
  return dedupeNormalizeRelayUrlsOrdered([...local, ...remote])
}

const normFastRead = (): string[] =>
  dedupeNormalizeRelayUrlsOrdered(
    FAST_READ_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter(Boolean) as string[]
  )

const normFastWrite = (): string[] =>
  dedupeNormalizeRelayUrlsOrdered(
    FAST_WRITE_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter(Boolean) as string[]
  )

/**
 * Ordered layers for REQ / read (before merge, dedupe, blocked strip, social-kind strip, cap).
 */
export function buildReadRelayPriorityLayers(opts: {
  userReadRelays: string[]
  userWriteRelays?: string[]
  authorWriteRelays?: string[]
  favoriteRelays: string[]
  /** When false, omit the global FAST_READ tier (logged-in users with their own relay stack). Default true. */
  includeGlobalFastRead?: boolean
}): string[][] {
  const userWrite = opts.userWriteRelays ?? []
  const writeLocals = userWrite.filter((u) => {
    const n = normalizeAnyRelayUrl(u) || u.trim()
    return n && isLocalNetworkUrl(n)
  })
  const userReadOrdered = relayUrlsLocalsFirst(opts.userReadRelays)
  const tier1 = dedupeNormalizeRelayUrlsOrdered([...writeLocals, ...userReadOrdered])
  const tier2 = dedupeNormalizeRelayUrlsOrdered(opts.authorWriteRelays ?? [])
  const tier3 = dedupeNormalizeRelayUrlsOrdered(opts.favoriteRelays ?? [])
  const tier4 = opts.includeGlobalFastRead === false ? [] : normFastRead()
  return [tier1, tier2, tier3, tier4]
}

/**
 * REQ / read: user inboxes (locals first) + user local outboxes → author outboxes → favorites → FAST_READ.
 * Blocked and (optionally) social-kind-blocked relays are removed before slicing to `maxRelays`.
 */
export function buildPrioritizedReadRelayUrls(opts: {
  userReadRelays: string[]
  userWriteRelays?: string[]
  authorWriteRelays?: string[]
  favoriteRelays: string[]
  blockedRelays?: string[]
  maxRelays?: number
  /** Default true: strip {@link SOCIAL_KIND_BLOCKED_RELAY_URLS} for social-kind-heavy timelines. Set false for other queries. */
  applySocialKindBlockedFilter?: boolean
  /** Default true: append global FAST_READ tier. */
  includeGlobalFastRead?: boolean
}): string[] {
  const max = opts.maxRelays ?? MAX_CONCURRENT_RELAY_CONNECTIONS
  const applySocial = opts.applySocialKindBlockedFilter !== false
  const exemptFromSocial = new Set<string>()
  for (const u of opts.userReadRelays ?? []) {
    const n = normalizeRelayUrlByScheme(u) || u.trim()
    if (n) exemptFromSocial.add(n.toLowerCase())
  }
  const layers = buildReadRelayPriorityLayers({
    userReadRelays: opts.userReadRelays,
    userWriteRelays: opts.userWriteRelays,
    authorWriteRelays: opts.authorWriteRelays,
    favoriteRelays: opts.favoriteRelays,
    includeGlobalFastRead: opts.includeGlobalFastRead
  })
  const policyLayers: FeedRelayLayer[] = [
    { source: 'viewer-read', urls: layers[0] ?? [] },
    { source: 'author-write', urls: layers[1] ?? [] },
    { source: 'favorites', urls: layers[2] ?? [] },
    { source: 'fast-read', urls: layers[3] ?? [] }
  ]
  return feedRelayPolicyUrls(policyLayers, {
    operation: 'read',
    blockedRelays: opts.blockedRelays,
    maxRelays: max,
    applySocialKindBlockedFilter: applySocial,
    socialKindBlockedExemptRelays: [...exemptFromSocial],
    allowThirdPartyLocalRelays: true
  })
}

/**
 * Ordered layers for publish / write (before merge, blocked strip, kind-1 strip, cap).
 */
function buildWriteRelayPriorityLayers(opts: {
  userWriteRelays: string[]
  authorReadRelays?: string[]
  favoriteRelays?: string[]
  extraRelays?: string[]
  /** When false, omit global FAST_WRITE tail. Default true. */
  includeGlobalFastWriteReadTails?: boolean
}): string[][] {
  const tier1 = relayUrlsLocalsFirst(opts.userWriteRelays)
  const tier2 = filterContextAuthorReadRelaysForPublish(opts.authorReadRelays ?? [])
  const tier3 = dedupeNormalizeRelayUrlsOrdered(opts.favoriteRelays ?? [])
  const tier4 = dedupeNormalizeRelayUrlsOrdered(opts.extraRelays ?? [])
  if (opts.includeGlobalFastWriteReadTails === false) {
    return [tier1, tier2, tier3, tier4, []]
  }
  const tier5 = normFastWrite()
  return [tier1, tier2, tier3, tier4, tier5]
}

/**
 * Publish / write: user outboxes (locals first) → target author inboxes → favorites → extras → FAST_WRITE.
 * Read aggregators ({@link FAST_READ_RELAY_URLS}) are intentionally omitted — they reject social writes.
 */
export function buildPrioritizedWriteRelayUrls(opts: {
  userWriteRelays: string[]
  authorReadRelays?: string[]
  favoriteRelays?: string[]
  extraRelays?: string[]
  blockedRelays?: string[]
  maxRelays?: number
  /** When true, strip {@link SOCIAL_KIND_BLOCKED_RELAY_URLS} before capping (social kinds). */
  applySocialKindBlockedFilter?: boolean
  /** Default true: append FAST_WRITE tier. */
  includeGlobalFastWriteReadTails?: boolean
}): string[] {
  const max = opts.maxRelays ?? MAX_PUBLISH_RELAYS
  const layers = buildWriteRelayPriorityLayers({
    userWriteRelays: opts.userWriteRelays,
    authorReadRelays: opts.authorReadRelays,
    favoriteRelays: opts.favoriteRelays,
    extraRelays: opts.extraRelays,
    includeGlobalFastWriteReadTails: opts.includeGlobalFastWriteReadTails
  })
  return feedRelayPolicyUrls([
    { source: 'viewer-write', urls: layers[0] ?? [] },
    { source: 'author-read', urls: layers[1] ?? [] },
    { source: 'favorites', urls: layers[2] ?? [] },
    { source: 'explicit', urls: layers[3] ?? [] },
    { source: 'fast-write', urls: layers[4] ?? [] }
  ], {
    operation: 'write',
    blockedRelays: opts.blockedRelays,
    maxRelays: max,
    nostrLandAggr: 'never',
    applySocialKindBlockedFilter: opts.applySocialKindBlockedFilter === true,
    allowThirdPartyLocalRelays: true
  })
}
