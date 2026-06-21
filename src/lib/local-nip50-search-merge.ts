import { eventMatchesGeneralSearchQuery } from '@/lib/general-search-text-match'
import indexedDb from '@/services/indexed-db.service'
import { eventService } from '@/services/client.service'
import type { Event } from 'nostr-tools'

export type CollectLocalTextSearchParams = {
  query: string
  /** Kind filter (same semantics as search page `kinds`). */
  allowedKinds: readonly number[]
  /**
   * Session LRU scan cap for {@link EventService.getSessionEventsMatchingSearch}.
   * Use `0` when the caller already merged the session layer synchronously.
   */
  sessionCap: number
  /** `limit` passed to {@link IndexedDbService.getCachedAndArchivedEventsMatchingLocalSearch}. */
  idbMergedLimit: number
  /** Max time spent scanning {@link StoreNames.EVENT_ARCHIVE} rows. */
  archiveScanMaxMs?: number
  /** Max cursor steps on {@link StoreNames.PUBLICATION_EVENTS} during local search. */
  publicationScanBudget?: number
  /** Max wall time on {@link StoreNames.PUBLICATION_EVENTS} during local search. */
  publicationScanMaxMs?: number
  /** Max wall time for {@link IndexedDbService.searchAllCachedEventsFullText} when enabled. */
  fullTextScanMaxMs?: number
  /** Hard stop for the whole local merge; returns partial hits collected so far. */
  totalMaxMs?: number
  /**
   * When true, also scan non–event-archive stores via {@link IndexedDbService.searchAllCachedEventsFullText}
   * (same extra coverage as the mention / citation picker path).
   */
  includeOtherStoresFullText?: boolean
  /** Max rows from {@link IndexedDbService.searchAllCachedEventsFullText} when enabled. */
  fullTextStoreHitCap?: number
}

function localSearchPastDeadline(deadlineMs: number | undefined): boolean {
  return deadlineMs !== undefined && Date.now() >= deadlineMs
}

function localSearchRemainingMs(deadlineMs: number | undefined): number | undefined {
  if (deadlineMs === undefined) return undefined
  return Math.max(0, deadlineMs - Date.now())
}

/**
 * Merges local session + publication + event-archive (and optionally other IndexedDB stores) for the same
 * text query and kind filter, deduped by id, sorted newest-first. Every row must satisfy
 * {@link eventMatchesGeneralSearchQuery} (defense in depth on top of store-specific scans).
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
  const deadlineMs =
    params.totalMaxMs !== undefined && params.totalMaxMs > 0
      ? Date.now() + params.totalMaxMs
      : undefined

  const push = (ev: Event) => {
    if (!kindSet.has(ev.kind)) return
    if (!eventMatchesGeneralSearchQuery(ev, q)) return
    if (seen.has(ev.id)) return
    seen.add(ev.id)
    out.push(ev)
  }

  if (params.sessionCap > 0) {
    for (const ev of eventService.getSessionEventsMatchingSearch(q, params.sessionCap, kindsArr)) {
      push(ev)
    }
  }

  if (!localSearchPastDeadline(deadlineMs) && params.includeOtherStoresFullText) {
    const cap = params.fullTextStoreHitCap ?? 260
    const remaining = localSearchRemainingMs(deadlineMs)
    const scanMaxMs =
      remaining !== undefined
        ? Math.min(params.fullTextScanMaxMs ?? remaining, remaining)
        : params.fullTextScanMaxMs
    try {
      const hits = await indexedDb.searchAllCachedEventsFullText(q, { limit: cap, scanMaxMs })
      for (const hit of hits) {
        if (hit.value) push(hit.value as Event)
      }
    } catch {
      /* optional cross-store scan */
    }
  }

  if (!localSearchPastDeadline(deadlineMs)) {
    const remaining = localSearchRemainingMs(deadlineMs)
    const archiveScanMaxMs =
      remaining !== undefined
        ? Math.min(params.archiveScanMaxMs ?? remaining, remaining)
        : params.archiveScanMaxMs
    const publicationScanMaxMs =
      remaining !== undefined
        ? Math.min(params.publicationScanMaxMs ?? remaining, remaining)
        : params.publicationScanMaxMs
    const fromPubArchive = await indexedDb.getCachedAndArchivedEventsMatchingLocalSearch(
      q,
      params.idbMergedLimit,
      kindsArr,
      {
        archiveScanMaxMs,
        publicationScanBudget: params.publicationScanBudget,
        publicationScanMaxMs
      }
    )
    for (const ev of fromPubArchive) {
      push(ev)
    }
  }

  out.sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))
  return out
}
