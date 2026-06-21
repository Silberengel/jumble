import { FAST_READ_RELAY_URLS } from '@/constants'
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
import { resolveEventPointerToHex } from '@/lib/thread-context-local'
import { normalizeUrl } from '@/lib/url'
import client from '@/services/client.service'

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
 * Search-relay fallback for note-by-id lookup (matches NotePage NotFound external search):
 * tag/bech32 hints → seen relays → aggr-aware {@link SEARCHABLE_RELAY_URLS} → {@link FAST_READ_RELAY_URLS}.
 */
export function buildNoteSearchRelayFallbackUrls(options: {
  relayHints?: readonly string[]
  seenRelayUrls?: readonly string[]
  nostrLandAggrEligibilityUrls?: readonly string[]
  blockedRelays?: readonly string[]
}): string[] {
  const eligibility = options.nostrLandAggrEligibilityUrls ?? []
  const layers: string[][] = []
  if (options.relayHints?.length) {
    layers.push([...options.relayHints])
  }
  if (options.seenRelayUrls?.length) {
    layers.push([...options.seenRelayUrls])
  }
  layers.push(
    getAggrAwareSearchRelayUrls(eligibility).map((u) => normalizeUrl(u) || u).filter(Boolean)
  )
  layers.push(
    FAST_READ_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter(Boolean)
  )
  return prependAggrNostrLandIfViewerEligible(
    mergeRelayUrlLayers(layers, [...(options.blockedRelays ?? [])]),
    eligibility
  )
}

/**
 * Wide relay stack for parent-note blurbs, thread parent/root fallback, and missing-reply search.
 */
export async function buildNoteLookupSearchFallbackRelayUrls(
  options: NoteLookupSearchRelayOptions & {
    relayHints?: readonly string[]
    /** Hex, note1, or nevent — used for seen-relay hints. */
    eventId?: string | null
  }
): Promise<string[]> {
  const { favoriteRelays, blockedRelays, relayHints, eventId } = options
  const eligibility =
    options.nostrLandAggrEligibilityUrls ??
    urlsForViewerNostrLandAggrEligibilitySync({ favoriteRelayUrls: favoriteRelays })
  const hex = eventId ? resolveEventPointerToHex(eventId) : undefined
  const seen = hex ? client.getSeenEventRelayUrls(hex) : []
  return buildNoteSearchRelayFallbackUrls({
    relayHints,
    seenRelayUrls: seen,
    nostrLandAggrEligibilityUrls: eligibility,
    blockedRelays: blockedRelays
  })
}

export { buildViewerNostrLandAggrEligibilityUrls }
