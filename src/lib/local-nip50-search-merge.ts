import { eventMatchesNip50LocalFullTextQuery } from '@/lib/nip50-local-text-match'
import indexedDb from '@/services/indexed-db.service'
import { eventService } from '@/services/client.service'
import type { Event } from 'nostr-tools'

export type CollectLocalTextSearchParams = {
  query: string
  /** Kind filter (same semantics as NIP-50 `kinds` on relays). */
  allowedKinds: readonly number[]
  /**
   * Session LRU scan cap for {@link EventService.getSessionEventsMatchingSearch}.
   * Use `0` when the caller already merged the session layer synchronously.
   */
  sessionCap: number
  /** `limit` passed to {@link IndexedDbService.getCachedAndArchivedEventsMatchingLocalSearch}. */
  idbMergedLimit: number
  archiveScanMaxMs?: number
  /**
   * When true, also scan non–event-archive stores via {@link IndexedDbService.searchAllCachedEventsFullText}
   * (same extra coverage as the mention / citation picker path).
   */
  includeOtherStoresFullText?: boolean
  /** Max rows from {@link IndexedDbService.searchAllCachedEventsFullText} when enabled. */
  fullTextStoreHitCap?: number
}

/**
 * Merges local session + publication + event-archive (and optionally other IndexedDB stores) for the same
 * text query and kind filter, deduped by id, sorted newest-first. Every row must satisfy
 * {@link eventMatchesNip50LocalFullTextQuery} (defense in depth on top of store-specific scans).
 */
export async function collectLocalEventsForTextSearch(
  params: CollectLocalTextSearchParams
): Promise<Event[]> {
  const q = params.query.trim()
  if (!q) return []

  const kindsArr = [...params.allowedKinds]
  if (kindsArr.length === 0) return []

  const kindSet = new Set(kindsArr)
  const seen = new Set<string>()
  const out: Event[] = []

  const push = (ev: Event) => {
    if (!kindSet.has(ev.kind)) return
    if (!eventMatchesNip50LocalFullTextQuery(ev, q)) return
    if (seen.has(ev.id)) return
    seen.add(ev.id)
    out.push(ev)
  }

  if (params.sessionCap > 0) {
    for (const ev of eventService.getSessionEventsMatchingSearch(q, params.sessionCap, kindsArr)) {
      push(ev)
    }
  }

  const idbOpts =
    params.archiveScanMaxMs !== undefined ? { archiveScanMaxMs: params.archiveScanMaxMs } : undefined
  const fromPubArchive = await indexedDb.getCachedAndArchivedEventsMatchingLocalSearch(
    q,
    params.idbMergedLimit,
    kindsArr,
    idbOpts
  )
  for (const ev of fromPubArchive) {
    push(ev)
  }

  if (params.includeOtherStoresFullText) {
    const cap = params.fullTextStoreHitCap ?? 260
    try {
      const hits = await indexedDb.searchAllCachedEventsFullText(q, { limit: cap })
      for (const hit of hits) {
        if (hit.value) push(hit.value as Event)
      }
    } catch {
      /* optional cross-store scan */
    }
  }

  out.sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))
  return out
}
