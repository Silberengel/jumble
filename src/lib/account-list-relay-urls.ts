import { getFavoritesFeedRelayUrls } from '@/lib/favorites-feed-relays'
import { buildPrioritizedReadRelayUrls, buildPrioritizedWriteRelayUrls } from '@/lib/relay-url-priority'
import { normalizeRelayUrlByScheme } from '@/lib/url'
import { collectViewerReadInboxUrls } from '@/lib/viewer-read-inboxes'
import { collectViewerWriteOutboxUrls } from '@/lib/viewer-write-outboxes'
import { viewerUsesGlobalRelayDefaults } from '@/lib/viewer-relay-defaults'
import client from '@/services/client.service'

/**
 * Read + write relay stack for merging replaceable list events (pins, bookmarks, follows, …)
 * before publishing an update — same idea as {@link BookmarksProvider}'s comprehensive list.
 */
export async function buildAccountListRelayUrlsForMerge(options: {
  accountPubkey: string
  favoriteRelays: string[]
  blockedRelays: string[]
}): Promise<string[]> {
  const { accountPubkey, favoriteRelays, blockedRelays } = options
  const myRelayList = await client.fetchRelayList(accountPubkey)
  const useGlobal = viewerUsesGlobalRelayDefaults({
    viewerPubkey: accountPubkey,
    favoriteRelayUrls: favoriteRelays ?? [],
    relayList: myRelayList
  })
  const favoritesTier = getFavoritesFeedRelayUrls(favoriteRelays ?? [], blockedRelays, useGlobal)
  const writeOutboxes = await collectViewerWriteOutboxUrls(accountPubkey, myRelayList)
  const readInboxes = await collectViewerReadInboxUrls(accountPubkey, myRelayList)
  const read = buildPrioritizedReadRelayUrls({
    userReadRelays: readInboxes,
    userWriteRelays: writeOutboxes,
    favoriteRelays: favoritesTier,
    blockedRelays,
    maxRelays: 100,
    applySocialKindBlockedFilter: false,
    includeGlobalFastRead: useGlobal
  })
  const write = buildPrioritizedWriteRelayUrls({
    userWriteRelays: writeOutboxes,
    favoriteRelays: favoritesTier,
    blockedRelays,
    maxRelays: 100,
    applySocialKindBlockedFilter: false,
    includeGlobalFastWriteReadTails: useGlobal
  })
  const merged = [...read, ...write]
  return [...new Set(merged.map((u) => normalizeRelayUrlByScheme(u) || u).filter(Boolean))]
}
