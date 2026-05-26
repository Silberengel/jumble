import client from '@/services/client.service'
import {
  collectViewerWriteOutboxUrls,
  viewerHasWriteOutboxes
} from '@/lib/viewer-write-outboxes'
import indexedDb from '@/services/indexed-db.service'
import { ExtendedKind } from '@/constants'
import type { Event } from 'nostr-tools'

/** Kind 10432 relay tag URLs from an in-memory event (sync). */
export function getCacheRelayUrlsFromEvent(event: Event | null | undefined): string[] {
  if (!event) return []
  const relayUrls: string[] = []
  event.tags.forEach((tag) => {
    if (tag[0] === 'relay' && tag[1]) {
      relayUrls.push(tag[1])
    }
  })
  return Array.from(new Set(relayUrls))
}

/**
 * Check if user has private relays available (outbox relays or cache relays)
 */
export async function hasPrivateRelays(pubkey: string): Promise<boolean> {
  const relayList = await client.peekRelayListFromStorage(pubkey)
  return viewerHasWriteOutboxes(pubkey, relayList)
}

/**
 * Get private relay URLs (kind 10002 WS + kind 10243 HTTP + kind 10432 cache write outboxes)
 */
export async function getPrivateRelayUrls(pubkey: string): Promise<string[]> {
  const relayList = await client.peekRelayListFromStorage(pubkey)
  return collectViewerWriteOutboxUrls(pubkey, relayList)
}

/**
 * Get cache relay URLs only (kind 10432)
 * @param pubkey - User's public key
 * @returns Promise<string[]> - Array of cache relay URLs
 */
export async function getCacheRelayUrls(pubkey: string): Promise<string[]> {
  const cacheRelayEvent = await indexedDb.getReplaceableEvent(pubkey, ExtendedKind.CACHE_RELAYS)
  return getCacheRelayUrlsFromEvent(cacheRelayEvent)
}
