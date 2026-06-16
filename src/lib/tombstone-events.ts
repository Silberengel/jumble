import { PROFILE_RELAY_URLS } from '@/constants'
import { normalizeAnyRelayUrl, normalizeUrl } from '@/lib/url'
import { collectUserReadInboxUrls } from '@/lib/viewer-read-inboxes'
import { collectUserWriteOutboxUrls } from '@/lib/viewer-write-outboxes'
import type { TRelayList } from '@/types'

/** Dispatched after tombstones in IndexedDB change (kind-5 sync or local apply). */
export const TOMBSTONES_UPDATED_EVENT = 'jumble:tombstonesUpdated'

export type TombstonesUpdatedDetail = {
  /** Keys written in this update — merged into UI state before IDB hydrate completes. */
  keys?: string[]
}

export function dispatchTombstonesUpdated(keys?: Iterable<string>): void {
  if (typeof window === 'undefined') return
  const keyList = keys ? [...keys] : undefined
  window.dispatchEvent(
    new CustomEvent<TombstonesUpdatedDetail>(TOMBSTONES_UPDATED_EVENT, {
      detail: keyList?.length ? { keys: keyList } : undefined
    })
  )
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
