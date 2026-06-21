import { buildAccountListRelayUrlsForMerge } from '@/lib/account-list-relay-urls'
import {
  getFavoritesFeedRelayUrls,
  mergeRelayUrlLayers
} from '@/lib/favorites-feed-relays'
import {
  buildViewerNostrLandAggrEligibilityUrls,
  getAggrAwareSearchRelayUrls,
  prependAggrNostrLandIfViewerEligible,
  urlsForViewerNostrLandAggrEligibilitySync
} from '@/lib/nostr-land-relay-eligibility'
import { buildComprehensiveRelayList } from '@/lib/relay-list-builder'
import { normalizeUrl } from '@/lib/url'

export type NoteLookupSearchRelayOptions = {
  viewerPubkey: string | null | undefined
  favoriteRelays: string[]
  blockedRelays: string[]
  /** Favorites + NIP-65 + cache + HTTP (+ optional relay sets) for aggr.nostr.land eligibility. */
  nostrLandAggrEligibilityUrls?: readonly string[]
}

/**
 * Relay stack for “search loaded posts” → **full relay search**: searchable relays, favorites (kind 10012 + defaults),
 * logged-in account read/write merge, then {@link buildComprehensiveRelayList} (user NIP-65 + local + profile + fast
 * read/write + search + favorites). When {@link filterAuthorHex} differs from the viewer, that author’s NIP-65 in/out
 * (incl. http) is included via `authorPubkey`.
 */
export async function buildFeedFullSearchRelayUrls(options: {
  viewerPubkey: string | null | undefined
  filterAuthorHex: string | null | undefined
  favoriteRelays: string[]
  blockedRelays: string[]
  nostrLandAggrEligibilityUrls?: readonly string[]
}): Promise<string[]> {
  const { viewerPubkey, filterAuthorHex, favoriteRelays, blockedRelays } = options
  const blocked = blockedRelays ?? []
  const eligibility =
    options.nostrLandAggrEligibilityUrls ??
    urlsForViewerNostrLandAggrEligibilitySync({ favoriteRelayUrls: favoriteRelays })
  const layers: string[][] = []

  layers.push(getAggrAwareSearchRelayUrls(eligibility).map((u) => normalizeUrl(u) || u).filter(Boolean))

  layers.push(getFavoritesFeedRelayUrls(favoriteRelays ?? [], blocked))

  if (viewerPubkey) {
    try {
      const account = await buildAccountListRelayUrlsForMerge({
        accountPubkey: viewerPubkey,
        favoriteRelays: favoriteRelays ?? [],
        blockedRelays: blocked
      })
      layers.push(account)
    } catch {
      /* continue with other layers */
    }
  }

  const viewerLower = viewerPubkey?.toLowerCase()
  const authorLower = filterAuthorHex?.toLowerCase()
  const authorForN65 =
    filterAuthorHex && authorLower !== viewerLower ? filterAuthorHex : undefined

  try {
    const comprehensive = await buildComprehensiveRelayList({
      userPubkey: viewerPubkey ?? undefined,
      authorPubkey: authorForN65,
      includeUserOwnRelays: !!viewerPubkey,
      includeProfileFetchRelays: true,
      includeFastReadRelays: true,
      includeFastWriteRelays: true,
      includeSearchableRelays: true,
      includeLocalRelays: true,
      includeFavoriteRelays: !!viewerPubkey,
      blockedRelays: blocked
    })
    layers.push(comprehensive)
  } catch {
    /* merge without comprehensive */
  }

  return prependAggrNostrLandIfViewerEligible(mergeRelayUrlLayers(layers, blocked), eligibility)
}

/**
 * Wide relay stack for parent-note blurbs, thread parent/root fallback, and missing-reply search:
 * child tag hints → searchable relays (incl. aggr when eligible) → favorites → viewer inbox → comprehensive list.
 */
export async function buildNoteLookupSearchFallbackRelayUrls(
  options: NoteLookupSearchRelayOptions & {
    relayHints?: readonly string[]
  }
): Promise<string[]> {
  const { viewerPubkey, favoriteRelays, blockedRelays, relayHints } = options
  const eligibility =
    options.nostrLandAggrEligibilityUrls ??
    urlsForViewerNostrLandAggrEligibilitySync({ favoriteRelayUrls: favoriteRelays })
  const layers: string[][] = []
  if (relayHints?.length) {
    layers.push([...relayHints])
  }
  layers.push(
    await buildFeedFullSearchRelayUrls({
      viewerPubkey,
      filterAuthorHex: undefined,
      favoriteRelays,
      blockedRelays,
      nostrLandAggrEligibilityUrls: eligibility
    })
  )
  return prependAggrNostrLandIfViewerEligible(mergeRelayUrlLayers(layers, blockedRelays), eligibility)
}

export { buildViewerNostrLandAggrEligibilityUrls }
