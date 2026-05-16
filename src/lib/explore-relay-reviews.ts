import { ExtendedKind } from '@/constants'
import { getReplaceableCoordinateFromEvent, isReplaceableEvent } from '@/lib/event'
import { getRelayUrlFromRelayReviewEvent } from '@/lib/event-metadata'
import { isExploreBrowsableRelayUrl } from '@/lib/explore-popular-relays'
import client from '@/services/client.service'
import indexedDb, { StoreNames } from '@/services/indexed-db.service'
import type { Event } from 'nostr-tools'

export function dedupeRelayReviewsNewestFirst(events: Event[]): Event[] {
  const sorted = [...events].sort((a, b) => b.created_at - a.created_at)
  const seen = new Set<string>()
  const out: Event[] = []
  for (const evt of sorted) {
    const key = isReplaceableEvent(evt.kind) ? getReplaceableCoordinateFromEvent(evt) : evt.id
    if (seen.has(key)) continue
    seen.add(key)
    out.push(evt)
  }
  return out
}

export async function loadCachedRelayReviews(limit: number): Promise<Event[]> {
  const fromSession = client
    .getSessionEventsMatchingSearch('', Math.max(limit * 2, 200), [ExtendedKind.RELAY_REVIEW])
    .filter((e) => e.kind === ExtendedKind.RELAY_REVIEW && !!getRelayUrlFromRelayReviewEvent(e))
  if (fromSession.length >= limit) {
    return dedupeRelayReviewsNewestFirst(fromSession).slice(0, limit)
  }

  try {
    const archiveRows = await indexedDb.getStoreItems(StoreNames.EVENT_ARCHIVE)
    const fromArchive = archiveRows
      .map((row) => row?.value as Event | undefined)
      .filter(
        (e): e is Event =>
          !!e && e.kind === ExtendedKind.RELAY_REVIEW && !!getRelayUrlFromRelayReviewEvent(e)
      )
    return dedupeRelayReviewsNewestFirst([...fromSession, ...fromArchive]).slice(0, limit)
  } catch {
    return dedupeRelayReviewsNewestFirst(fromSession).slice(0, limit)
  }
}

export function groupRelayReviewsByUrl(events: Event[]): Map<string, Event[]> {
  const groups = new Map<string, Event[]>()
  for (const event of dedupeRelayReviewsNewestFirst(events)) {
    const url = getRelayUrlFromRelayReviewEvent(event)
    if (!url || !isExploreBrowsableRelayUrl(url)) continue
    if (!groups.has(url)) groups.set(url, [])
    groups.get(url)!.push(event)
  }
  return groups
}
