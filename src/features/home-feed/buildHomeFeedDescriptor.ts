import { createFeedDescriptor, type FeedDescriptor } from '@/features/feed/descriptor'
import { mapNoteListSubRequestsForTimeline } from '@/features/feed/note-list-requests'
import {
  ensureHomeFeedTrendingRelay,
  stripNostrLandAggrFromTimelineSubRequests
} from '@/lib/home-feed-relays'
import {
  HOME_FEED_RELAY_SOURCE_FAVORITES,
  homeFeedSubscriptionKeys,
  isHomeFeedRelaySetSource
} from '@/lib/home-feed-relay-source'
import { dedupeNormalizeRelayUrlsOrdered } from '@/lib/relay-url-priority'
import { normalizeUrl } from '@/lib/url'
import type { TFeedSubRequest, TNoteListMode } from '@/types'
import { kinds } from 'nostr-tools'
import { HOME_FEED_PAGE_LIMIT } from './constants'

export type HomeFeedListMode = TNoteListMode

export type BuildHomeFeedDescriptorInput = {
  homeFeedRelaySource: string
  relayUrls: readonly string[]
  replyRelayUrls: readonly string[]
  showKinds: readonly number[]
  listMode: HomeFeedListMode
  seeAllFeedEvents: boolean
  areAlgoRelays?: boolean
}

export type HomeFeedDescriptorBundle = {
  descriptor: FeedDescriptor
  sinceScopeKey: string
  subscriptionKey: string
  relaySetFeedOnly: boolean
  notesSubRequests: TFeedSubRequest[]
  repliesSubRequests: TFeedSubRequest[]
  activeSubRequests: TFeedSubRequest[]
  seenOnAllowlistOp: string[]
  seenOnAllowlistReplies: string[]
}

function stableRelayUrls(urls: readonly string[]): string[] {
  return dedupeNormalizeRelayUrlsOrdered(urls)
}

function relayUrlsKey(urls: readonly string[]): string {
  return [...urls]
    .map((u) => normalizeUrl(u) || u)
    .filter(Boolean)
    .sort()
    .join('|')
}

export function buildHomeFeedSubRequests(
  relayUrls: readonly string[],
  replyRelayUrls: readonly string[],
  homeFeedRelaySource: string,
  defaultKinds: readonly number[]
): { notes: TFeedSubRequest[]; replies: TFeedSubRequest[] } {
  const stableNotes = stableRelayUrls(relayUrls)
  const stableReplies = stableRelayUrls(
    replyRelayUrls.length > 0 ? replyRelayUrls : relayUrls
  )
  const widenFavorites = homeFeedRelaySource === HOME_FEED_RELAY_SOURCE_FAVORITES
  const widen = (urls: string[]) =>
    dedupeNormalizeRelayUrlsOrdered(
      widenFavorites ? ensureHomeFeedTrendingRelay(urls) : urls
    )

  const mk = (urls: string[]): TFeedSubRequest[] =>
    urls.length === 0
      ? []
      : [
          {
            urls: widen(urls),
            filter: { kinds: [...defaultKinds] }
          }
        ]

  return {
    notes: mk(stableNotes),
    replies: mk(stableReplies)
  }
}

export function mapHomeFeedSubRequestsForTimeline(
  requests: readonly TFeedSubRequest[],
  showKinds: readonly number[],
  seeAllFeedEvents: boolean,
  areAlgoRelays: boolean
): TFeedSubRequest[] {
  return mapNoteListSubRequestsForTimeline(requests, {
    defaultKinds: showKinds.length > 0 ? showKinds : [kinds.ShortTextNote],
    seeAllFeedEvents,
    useFilterAsIs: false,
    areAlgoRelays,
    allowKindlessRelayExplore: false,
    clientSideKindFilter: true,
    limit: HOME_FEED_PAGE_LIMIT,
    algoLimit: 200,
    relayExploreLimit: 500
  })
}

export function buildHomeFeedDescriptorBundle(
  input: BuildHomeFeedDescriptorInput
): HomeFeedDescriptorBundle | null {
  const relaySetFeedOnly = isHomeFeedRelaySetSource(input.homeFeedRelaySource)
  const stableNotes = stableRelayUrls(input.relayUrls)
  const stableReplies = stableRelayUrls(
    input.replyRelayUrls.length > 0 ? input.replyRelayUrls : input.relayUrls
  )
  if (stableNotes.length === 0 && stableReplies.length === 0) return null

  /** Posts tier follows favorites; when none are configured, fall back to the reply/inbox stack. */
  const notesRelayUrls =
    input.relayUrls.length > 0
      ? input.relayUrls
      : input.replyRelayUrls.length > 0
        ? input.replyRelayUrls
        : input.relayUrls

  const defaultKinds =
    input.showKinds.length > 0 ? [...input.showKinds] : [kinds.ShortTextNote]
  const { notes, replies } = buildHomeFeedSubRequests(
    notesRelayUrls,
    input.replyRelayUrls,
    input.homeFeedRelaySource,
    defaultKinds
  )

  const hideReplies = input.listMode === 'posts'
  const rawActive = hideReplies ? notes : replies
  const activeSubRequests = mapHomeFeedSubRequestsForTimeline(
    rawActive,
    input.showKinds,
    input.seeAllFeedEvents,
    input.areAlgoRelays ?? false
  )

  const { subscriptionKey, timelineScopeKey: sinceScopeKey } = homeFeedSubscriptionKeys(
    input.homeFeedRelaySource
  )

  const mappedNotes = mapHomeFeedSubRequestsForTimeline(
    notes,
    input.showKinds,
    input.seeAllFeedEvents,
    input.areAlgoRelays ?? false
  )
  const mappedReplies = mapHomeFeedSubRequestsForTimeline(
    replies,
    input.showKinds,
    input.seeAllFeedEvents,
    input.areAlgoRelays ?? false
  )

  const descriptor = createFeedDescriptor({
    surface: 'home',
    id: input.homeFeedRelaySource,
    requests: activeSubRequests,
    view: {
      showKinds: input.showKinds.length ? [...input.showKinds] : undefined,
      clientSideKindFilter: true,
      includeReplies: !hideReplies
    },
    source: {
      cache: 'stale-while-refresh',
      publicReadFallback: true,
      preserveRowsOnRelayChange: !relaySetFeedOnly
    },
    pagination: { enabled: true, pageSize: HOME_FEED_PAGE_LIMIT }
  })

  const seenOnAllowlistOp = stableNotes.length > 0 ? stableNotes : stableReplies
  const seenOnAllowlistReplies = stableReplies

  return {
    descriptor,
    sinceScopeKey,
    subscriptionKey,
    relaySetFeedOnly,
    notesSubRequests: stripNostrLandAggrFromTimelineSubRequests(subscriptionKey, mappedNotes),
    repliesSubRequests: stripNostrLandAggrFromTimelineSubRequests(subscriptionKey, mappedReplies),
    activeSubRequests: stripNostrLandAggrFromTimelineSubRequests(
      subscriptionKey,
      activeSubRequests
    ),
    seenOnAllowlistOp,
    seenOnAllowlistReplies
  }
}

export function homeFeedSessionSnapshotFeedKey(subscriptionKey: string): string {
  return subscriptionKey
}

export { relayUrlsKey }
