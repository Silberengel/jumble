import { PROFILE_RELAY_URLS } from '@/constants'
import { normalizeAnyRelayUrl, normalizeUrl } from '@/lib/url'
import { collectUserReadInboxUrls } from '@/lib/viewer-read-inboxes'
import { collectUserWriteOutboxUrls } from '@/lib/viewer-write-outboxes'
import type { TRelayList } from '@/types'

/** Dispatched after tombstones in IndexedDB change (kind-5 sync or local apply). */
export const TOMBSTONES_UPDATED_EVENT = 'jumble:tombstonesUpdated'

export function dispatchTombstonesUpdated(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(TOMBSTONES_UPDATED_EVENT))
}

/** Relay set for querying the current user's kind-5 events (aligned with login sync). */
export function buildDeletionRelayUrls(
  relayList: TRelayList | null | undefined,
  cacheUrls: readonly string[] = []
): string[] {
  const readInboxes = collectUserReadInboxUrls(relayList, cacheUrls)
  const writeOutboxes = collectUserWriteOutboxUrls(relayList, cacheUrls)
  if (readInboxes.length === 0 && writeOutboxes.length === 0) {
    return Array.from(
      new Set(PROFILE_RELAY_URLS.map((url) => normalizeUrl(url) || url).filter(Boolean))
    ).slice(0, 20)
  }
  return Array.from(
    new Set([
      ...writeOutboxes,
      ...readInboxes.slice(0, 8),
      ...PROFILE_RELAY_URLS.map((url: string) => normalizeAnyRelayUrl(url) || url)
    ])
  ).slice(0, 20)
}
