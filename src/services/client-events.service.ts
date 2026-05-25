import {
  AUTHOR_CORE_PREFETCH_ON_INGEST_KINDS,
  ExtendedKind,
  EXTERNAL_RELAY_EVENT_FETCH_EOSE_TIMEOUT_MS,
  EXTERNAL_RELAY_EVENT_FETCH_GLOBAL_TIMEOUT_MS,
  HINTED_EVENT_FETCH_EOSE_TIMEOUT_MS,
  HINTED_EVENT_FETCH_GLOBAL_TIMEOUT_MS,
  THREAD_CONTEXT_TRY_HARDER_GLOBAL_TIMEOUT_MS,
  isDocumentRelayKind,
  NOTE_STATS_OP_REFERENCE_KINDS_WITHOUT_HIGHLIGHT,
  SINGLE_EVENT_BY_ID_QUERY_EOSE_TIMEOUT_MS,
  SINGLE_EVENT_BY_ID_QUERY_GLOBAL_TIMEOUT_MS
} from '@/constants'
import { prependAggrForEventLookupRelayUrls } from '@/lib/nostr-land-relay-eligibility'
import { sanitizeRelayUrlsForFetch } from '@/lib/read-only-relay-personal'
import { urlIsNonLocalForRemoteViewer } from '@/lib/relay-list-sanitize'
import logger from '@/lib/logger'
import {
  collectEmbeddedEventPrefetchTargets,
  getParentATag,
  getParentETag,
  getQuotedReferenceFromQTags,
  getReplaceableCoordinateFromEvent,
  getRootATag,
  getRootETag,
  isNip18RepostKind,
  isNip25ReactionKind,
  isReplyNoteEvent,
  isReplaceableEvent,
  kind1QuotesThreadRoot,
  normalizeReplaceableCoordinateString,
  relayHintWssUrlsFromEvent
} from '@/lib/event'
import { getFirstHexEventIdFromETags, tagNameEquals } from '@/lib/tag'
import type { Event as NEvent, Filter } from 'nostr-tools'
import { kinds, nip19 } from 'nostr-tools'
import DataLoader from 'dataloader'
import { LRUCache } from 'lru-cache'
import indexedDb from './indexed-db.service'
import type { QueryService } from './client-query.service'
import client from './client.service'
import {
  invalidateArchiveFootprintCache,
  loadArchivedEventForFetch,
  prefetchArchivedEvents,
  queuePersistSeenEvent
} from './event-archive.service'
import { getDefaultSessionLruMaxSync } from '@/lib/event-archive-config'
import { isCalendarEventKind } from '@/lib/calendar-event'
import { citationPickerMatchesQuery } from '@/lib/citation-picker-search'
import { profileKind0MatchesSearchQuery } from '@/lib/profile-metadata-search'
import { shouldDropEventOnIngest, type ShouldDropEventOnIngestOptions } from '@/lib/event-ingest-filter'
import { eventMatchesNip50LocalFullTextQuery } from '@/lib/nip50-local-text-match'
import { eventMatchesAnyLocalFeedFilter } from '@/lib/feed-local-event-match'
import { buildComprehensiveRelayList } from '@/lib/relay-list-builder'
import { normalizeUrl } from '@/lib/url'

/** NIP-33 / NIP-01 `a` coordinate: `<kind>:<hex pubkey>:<d identifier>`. */
function parseReplaceableAtagCoordinate(atag: string): {
  kind: number
  pubkey: string
  identifier: string
} | null {
  const s = atag.trim()
  const i0 = s.indexOf(':')
  if (i0 < 0) return null
  const kind = Number.parseInt(s.slice(0, i0), 10)
  if (!Number.isFinite(kind)) return null
  const rest = s.slice(i0 + 1)
  const i1 = rest.indexOf(':')
  if (i1 < 0) return null
  const pubkey = rest.slice(0, i1).toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(pubkey)) return null
  const identifier = rest.slice(i1 + 1)
  return { kind, pubkey, identifier }
}

/**
 * Build comprehensive relay list for event-by-id fetch: user's inboxes (+ cache), **favorite relays
 * (kind 10012, same as sidebar menu)**, relay hints, author outboxes/inboxes when known,
 * FAST_READ_RELAY_URLS, and SEARCHABLE_RELAY_URLS.
 */
async function buildComprehensiveRelayListForEvents(
  authorPubkey: string | undefined,
  relayHints: string[] = [],
  seenRelays: string[] = [],
  containingEventRelays: string[] = []
): Promise<string[]> {
  return buildComprehensiveRelayList({
    authorPubkey,
    userPubkey: client.pubkey,
    relayHints,
    seenRelays,
    containingEventRelays,
    includeProfileFetchRelays: true,
    includeFastReadRelays: true,
    includeSearchableRelays: true,
    includeLocalRelays: true,
    includeFavoriteRelays: Boolean(client.pubkey),
    preferPublicReadRelaysEarly: true
  })
}

const PREFETCH_HEX_IDS_CHUNK = 48

/** Parent kinds that often embed `nostr:…` notes — prefetch targets on ingest with the parent. */
const EMBEDDED_NOTE_PREFETCH_ON_INGEST_KINDS = new Set<number>([
  kinds.ShortTextNote,
  kinds.LongFormArticle,
  kinds.Highlights,
  kinds.Repost,
  ExtendedKind.GENERIC_REPOST,
  ExtendedKind.PUBLICATION_CONTENT,
  ExtendedKind.WIKI_ARTICLE,
  ExtendedKind.NOSTR_SPECIFICATION,
  ExtendedKind.COMMENT,
  ExtendedKind.VOICE_COMMENT,
  ExtendedKind.DISCUSSION
])

/** Cap session LRU scan per note-stats target — cache iterates newest-first; avoids O(session)×batch stalls. */
const NOTE_STATS_SESSION_PREMERGE_SCAN_MAX = 6000

/** Max session events scanned for {@link EventService.getSessionEventsMatchingSearch} (Map order is not recency). */
const SESSION_SEARCH_MAX_SCAN = 48_000

export class EventService {
  private queryService: QueryService
  private eventCacheMap = new Map<string, Promise<NEvent | undefined>>()
  /**
   * In-memory session cache: events seen this tab session (timelines, queries, fetches).
   * Larger cap + no TTL so navigation and repeat fetches reuse data until reload.
   */
  /** Timelines + note-stats; cap is platform-aware (see Cache settings). */
  private sessionEventCache = new LRUCache<string, NEvent>({ max: getDefaultSessionLruMaxSync() })
  /** Latest kind-0 per pubkey from {@link sessionEventCache} for batch profile short-circuit. */
  private sessionMetadataByPubkey = new Map<string, NEvent>()
  /** Ingest coalescing: max `created_at` already queued for durable replaceable cache (coordinate → ts). */
  private ingestReplaceablePersistMaxCreatedAt = new Map<string, number>()

  private trimIngestReplaceablePersistMap(): void {
    const MAX = 12_000
    while (this.ingestReplaceablePersistMaxCreatedAt.size > MAX) {
      const k = this.ingestReplaceablePersistMaxCreatedAt.keys().next().value
      if (k === undefined) break
      this.ingestReplaceablePersistMaxCreatedAt.delete(k)
    }
  }

  /** Callbacks waiting for an event id to appear in {@link sessionEventCache} (e.g. embed loads before timeline caches the note). */
  private sessionEventWaiters = new Map<string, Set<() => void>>()
  /** Waiters keyed like {@link replaceableWaiterKey} — naddr embeds have no hex id until a REQ returns. */
  private sessionReplaceableWaiters = new Map<string, Set<() => void>>()
  private eventDataLoader: DataLoader<string, NEvent | undefined>
  private fetchEventFromBigRelaysDataloader: DataLoader<string, NEvent | undefined>

  constructor(queryService: QueryService) {
    this.queryService = queryService
    this.eventDataLoader = new DataLoader<string, NEvent | undefined>(
      (ids) => Promise.all(ids.map((id) => this._fetchEvent(id))),
      { cacheMap: this.eventCacheMap }
    )
    this.fetchEventFromBigRelaysDataloader = new DataLoader<string, NEvent | undefined>(
      this.fetchEventsFromBigRelays.bind(this),
      { cache: false, batchScheduleFn: (callback) => setTimeout(callback, 50) }
    )
  }

  /**
   * Lowercase hex id for note/nevent/raw hex; `null` for naddr or invalid ids.
   */
  private resolveHexWaiterKey(id: string): string | null {
    const trimmed = id.trim()
    if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase()
    try {
      const { type, data } = nip19.decode(trimmed)
      if (type === 'note') return data
      if (type === 'nevent') return data.id
    } catch {
      /* invalid */
    }
    return null
  }

  /** Returns cached event or undefined; evicts ingest-blocked events from the session LRU. */
  private getSessionEventIfAllowed(hexId: string, forExplicitNoteIdLookup = false): NEvent | undefined {
    const e = this.sessionEventCache.get(hexId)
    if (!e) return undefined
    const ingestOpts: ShouldDropEventOnIngestOptions | undefined = forExplicitNoteIdLookup
      ? { explicitNoteLookupHexId: hexId }
      : undefined
    if (shouldDropEventOnIngest(e, ingestOpts)) {
      this.sessionEventCache.delete(hexId)
      return undefined
    }
    return e
  }

  /**
   * Session cache is keyed by event `id` (hex). `fetchEvent("naddr1…")` has no hex until a REQ returns;
   * scan for a replaceable whose `kind`/`pubkey`/`d` matches the naddr (e.g. live 30311 already loaded from ticker/embed).
   */
  findSessionReplaceableByNaddr(data: {
    pubkey: string
    kind: number
    identifier: string
  }): NEvent | undefined {
    return this.getSessionEventIfMatchingNaddr(data)
  }

  private getSessionEventIfMatchingNaddr(data: {
    pubkey: string
    kind: number
    identifier: string
  }): NEvent | undefined {
    const pk = data.pubkey.toLowerCase()
    const { kind, identifier } = data
    for (const [, ev] of this.sessionEventCache.entries()) {
      if (shouldDropEventOnIngest(ev)) continue
      if (!isReplaceableEvent(ev.kind)) continue
      if (ev.kind !== kind || ev.pubkey.toLowerCase() !== pk) continue
      const d = ev.tags.find((t) => t[0] === 'd')?.[1] ?? ''
      if (d === (identifier ?? '')) return ev
    }
    return undefined
  }

  private notifySessionEventWaiters(hexId: string): void {
    const waiters = this.sessionEventWaiters.get(hexId)
    if (!waiters?.size) return
    /** Snapshot + remove before invoking: callbacks often call {@link addEventToCache} again (e.g. embed → addReplies), which would re-enter and stack-overflow otherwise. */
    const snapshot = [...waiters]
    this.sessionEventWaiters.delete(hexId)
    for (const cb of snapshot) {
      queueMicrotask(() => {
        try {
          cb()
        } catch (e) {
          logger.warn('[EventService] sessionEventWaiter failed', { hexId: hexId.slice(0, 8), e })
        }
      })
    }
  }

  private notifyReplaceableCoordinateWaiters(ev: NEvent): void {
    if (!isReplaceableEvent(ev.kind)) return
    const dTag = ev.tags.find((t) => t[0] === 'd')?.[1] ?? ''
    const key = `${ev.kind}:${ev.pubkey.toLowerCase()}:${dTag}`
    const waiters = this.sessionReplaceableWaiters.get(key)
    if (!waiters?.size) return
    const snapshot = [...waiters]
    this.sessionReplaceableWaiters.delete(key)
    for (const cb of snapshot) {
      try {
        cb()
      } catch (e) {
        logger.warn('[EventService] replaceable session waiter failed', { key, e })
      }
    }
  }

  /**
   * Read parent/root (or any) event from the session cache without removing it.
   * Accepts hex, note1, nevent1, or naddr1 (replaceable match in session LRU only).
   */
  peekSessionCachedEvent(noteId: string): NEvent | undefined {
    const trimmed = noteId.trim()
    const hex = this.resolveHexWaiterKey(trimmed)
    if (hex) {
      return this.getSessionEventIfAllowed(hex, true)
    }
    try {
      const { type, data } = nip19.decode(trimmed)
      if (type === 'naddr') {
        return this.getSessionEventIfMatchingNaddr({
          pubkey: data.pubkey,
          kind: data.kind,
          identifier: data.identifier ?? ''
        })
      }
    } catch {
      /* invalid */
    }
    return undefined
  }

  /**
   * IndexedDB publication store only (no session wait, no relay). Used to paint note stats before REQ.
   */
  async peekPublicationStoreEvent(hexId: string): Promise<NEvent | undefined> {
    const id = hexId.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(id)) return undefined
    const fromDb = await indexedDb.getEventFromPublicationStore(id)
    if (fromDb && !shouldDropEventOnIngest(fromDb, { explicitNoteLookupHexId: id })) {
      const ev = fromDb as NEvent
      this.addEventToCache(ev, { explicitNoteLookupHexId: id })
      return ev
    }
    return undefined
  }

  /**
   * When a matching event is added to the session cache, invoke `callback` (and when already cached).
   * Supports hex / note1 / nevent1 and **naddr1** (replaceable coordinate: kind + pubkey + `d`).
   */
  subscribeWhenSessionHasEvent(eventId: string, callback: () => void): () => void {
    const hex = this.resolveHexWaiterKey(eventId)
    if (hex) {
      if (this.getSessionEventIfAllowed(hex, true)) {
        queueMicrotask(() => callback())
        /** Already in cache: do not register a waiter — the next {@link addEventToCache} would notify again and double-fire embeds / useFetchEvent. */
        return () => {}
      }

      let set = this.sessionEventWaiters.get(hex)
      if (!set) {
        set = new Set()
        this.sessionEventWaiters.set(hex, set)
      }
      set.add(callback)
      return () => {
        set!.delete(callback)
        if (set!.size === 0) {
          this.sessionEventWaiters.delete(hex)
        }
      }
    }

    try {
      const { type, data } = nip19.decode(eventId.trim())
      if (type === 'naddr') {
        const identifier = data.identifier ?? ''
        if (
          this.getSessionEventIfMatchingNaddr({
            pubkey: data.pubkey,
            kind: data.kind,
            identifier
          })
        ) {
          queueMicrotask(() => callback())
          return () => {}
        }
        const key = `${data.kind}:${data.pubkey.toLowerCase()}:${identifier}`
        let rset = this.sessionReplaceableWaiters.get(key)
        if (!rset) {
          rset = new Set()
          this.sessionReplaceableWaiters.set(key, rset)
        }
        rset.add(callback)
        return () => {
          rset!.delete(callback)
          if (rset!.size === 0) {
            this.sessionReplaceableWaiters.delete(key)
          }
        }
      }
    } catch {
      /* invalid bech32 */
    }

    return () => {}
  }

  /**
   * Fetch single event by ID (hex, note1, nevent1, naddr1).
   * Optional `relayHints` (e.g. from the parent article’s tags) are merged first so REQ targets the same relays that likely hold the embed.
   */
  async fetchEvent(
    id: string,
    opts?: { relayHints?: string[]; /** Shorter timeouts; do not block note UI on parent/root. */ threadContext?: boolean }
  ): Promise<NEvent | undefined> {
    const trimmed = id.trim()
    let hexId: string | undefined
    let pointerHasFetchHints = false
    if (/^[0-9a-f]{64}$/i.test(trimmed)) {
      hexId = trimmed.toLowerCase()
    } else {
      try {
        const { type, data } = nip19.decode(trimmed)
        switch (type) {
          case 'note':
            hexId = data
            break
          case 'nevent':
            hexId = data.id
            pointerHasFetchHints = Boolean(data.author || data.relays?.length)
            break
          case 'naddr': {
            const ident = data.identifier ?? ''
            const fromSession = this.getSessionEventIfMatchingNaddr({
              pubkey: data.pubkey,
              kind: data.kind,
              identifier: ident
            })
            if (fromSession) return fromSession
            try {
              const fromIdb = await indexedDb.getReplaceableEvent(
                data.pubkey.toLowerCase(),
                data.kind,
                ident
              )
              if (fromIdb && fromIdb.kind === data.kind && !shouldDropEventOnIngest(fromIdb)) {
                this.addEventToCache(fromIdb)
                return fromIdb
              }
            } catch {
              /* optional */
            }
            break
          }
        }
      } catch {
        return undefined
      }
    }
    if (hexId) {
      const fromSession = this.getSessionEventIfAllowed(hexId, true)
      if (fromSession) return fromSession
      const cachedPromise = this.eventCacheMap.get(hexId)
      if (cachedPromise) {
        const resolved = await cachedPromise
        if (resolved && !shouldDropEventOnIngest(resolved, { explicitNoteLookupHexId: hexId }))
          return resolved
        const fromSessionAfterMiss = this.getSessionEventIfAllowed(hexId, true)
        if (fromSessionAfterMiss) return fromSessionAfterMiss
        const fromDb = await indexedDb.getEventFromPublicationStore(hexId)
        if (fromDb && !shouldDropEventOnIngest(fromDb, { explicitNoteLookupHexId: hexId })) {
          this.addEventToCache(fromDb, { explicitNoteLookupHexId: hexId })
          return fromDb
        }
        // Prior load() finished with undefined but left the promise in cacheMap — never retrying.
        this.eventDataLoader.clear(hexId)
      }
    }
    if (opts?.relayHints?.length || pointerHasFetchHints) {
      const hinted = await this._fetchEvent(trimmed, opts?.relayHints, opts?.threadContext)
      if (
        hinted &&
        !shouldDropEventOnIngest(hinted, hexId ? { explicitNoteLookupHexId: hexId } : undefined)
      )
        return hinted
    }
    const loaded = await this.eventDataLoader.load(hexId ?? trimmed)
    if (hexId) {
      const fromSessionAfter = this.getSessionEventIfAllowed(hexId, true)
      if (fromSessionAfter) return fromSessionAfter
    }
    if (loaded && shouldDropEventOnIngest(loaded, hexId ? { explicitNoteLookupHexId: hexId } : undefined)) {
      return undefined
    }
    return loaded
  }

  /**
   * Invalidate DataLoader cache for this id so the next fetch hits IndexedDB/relays again.
   * (Otherwise a prior `undefined` result stays cached forever.)
   */
  private clearDataloaderCacheForFetchId(id: string): void {
    const trimmed = id.trim()
    if (/^[0-9a-f]{64}$/i.test(trimmed)) {
      this.eventDataLoader.clear(trimmed.toLowerCase())
      return
    }
    try {
      const { type, data } = nip19.decode(trimmed)
      if (type === 'note') {
        this.eventDataLoader.clear(data)
      } else if (type === 'nevent') {
        this.eventDataLoader.clear(data.id)
      } else {
        this.eventDataLoader.clear(trimmed)
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * Force retry fetch event
   */
  async fetchEventForceRetry(
    eventId: string,
    opts?: { relayHints?: string[]; threadContext?: boolean }
  ): Promise<NEvent | undefined> {
    this.clearDataloaderCacheForFetchId(eventId)
    return this.fetchEvent(eventId, opts)
  }

  private readonly embeddedPrefetchHexScheduled = new Set<string>()
  private readonly embeddedPrefetchNip19Scheduled = new Set<string>()

  /**
   * Resolve embed targets from parent notes immediately (same relay hints as the parent).
   * Dedupes across feed batches / Note mounts; notifies session waiters when hits land.
   */
  prefetchEmbeddedEventsForParents(
    parents: readonly NEvent[],
    opts?: { relayHintsOnly?: boolean }
  ): void {
    if (parents.length === 0) return

    const hexSet = new Set<string>()
    const nip19Set = new Set<string>()
    const relayHintSet = new Set<string>()
    for (const parent of parents) {
      const { hexIds, nip19Pointers } = collectEmbeddedEventPrefetchTargets(parent)
      for (const id of hexIds) hexSet.add(id)
      for (const p of nip19Pointers) nip19Set.add(p)
      for (const url of relayHintWssUrlsFromEvent(parent)) {
        const n = normalizeUrl(url)
        if (n) relayHintSet.add(n)
      }
    }

    const hexIds = [...hexSet].filter((id) => {
      if (this.getSessionEventIfAllowed(id)) return false
      if (this.embeddedPrefetchHexScheduled.has(id)) return false
      this.embeddedPrefetchHexScheduled.add(id)
      return true
    })
    const nip19Pointers = [...nip19Set].filter((p) => {
      if (this.embeddedPrefetchNip19Scheduled.has(p)) return false
      this.embeddedPrefetchNip19Scheduled.add(p)
      return true
    })
    if (hexIds.length === 0 && nip19Pointers.length === 0) return

    const relayHints = [...relayHintSet]
    const fetchOpts = relayHints.length > 0 ? { relayHints } : undefined

    void (async () => {
      try {
        if (hexIds.length > 0) {
          await this.prefetchHexEventIds(hexIds, { relayHints, relayHintsOnly: opts?.relayHintsOnly })
        }
        await Promise.all(
          nip19Pointers.map((pointer) => this.fetchEvent(pointer, fetchOpts))
        )
      } catch {
        for (const id of hexIds) this.embeddedPrefetchHexScheduled.delete(id)
        for (const p of nip19Pointers) this.embeddedPrefetchNip19Scheduled.delete(p)
      }
    })()
  }

  /**
   * Batch-prefetch events by hex id into session cache (single REQ per chunk).
   * Used by feeds so embedded notes resolve without N parallel fetches.
   */
  async prefetchHexEventIds(
    rawIds: readonly string[],
    opts?: { relayHints?: string[]; relayHintsOnly?: boolean }
  ): Promise<void> {
    const hexIds = [
      ...new Set(
        rawIds
          .map((id) => id.trim().toLowerCase())
          .filter((id) => /^[0-9a-f]{64}$/.test(id))
      )
    ]
    let toFetch = hexIds.filter((id) => !this.getSessionEventIfAllowed(id))
    if (toFetch.length === 0) return

    const archived = await prefetchArchivedEvents(toFetch)
    for (const ev of archived) {
      if (!shouldDropEventOnIngest(ev)) this.addEventToCache(ev)
    }
    toFetch = toFetch.filter((id) => !this.getSessionEventIfAllowed(id))
    if (toFetch.length === 0) return

    const hints = (opts?.relayHints ?? [])
      .map((u) => normalizeUrl(u))
      .filter((u): u is string => Boolean(u))
    const relayUrls =
      opts?.relayHintsOnly && hints.length > 0
        ? [...new Set(hints)]
        : await buildComprehensiveRelayListForEvents(undefined, hints, hints, hints)
    if (!relayUrls.length) return

    for (let i = 0; i < toFetch.length; i += PREFETCH_HEX_IDS_CHUNK) {
      const chunk = toFetch.slice(i, i + PREFETCH_HEX_IDS_CHUNK)
      const events = await this.queryService.query(
        relayUrls,
        { ids: chunk, limit: chunk.length },
        undefined,
        {
          immediateReturn: false,
          eoseTimeout: hints.length > 0 ? 1800 : 2500,
          globalTimeout: hints.length > 0 ? 8000 : 12000
        }
      )
      for (const ev of events) {
        this.addEventToCache(ev)
      }
    }
  }

  /**
   * REQ filter for searching a note/nevent/naddr/hex id on arbitrary relays.
   */
  private filterForExternalRelayFetch(noteId: string): Filter | null {
    const trimmed = noteId.trim()
    if (/^[0-9a-f]{64}$/i.test(trimmed)) {
      return { ids: [trimmed.toLowerCase()], limit: 1 }
    }
    try {
      const { type, data } = nip19.decode(trimmed)
      if (type === 'note') return { ids: [data], limit: 1 }
      if (type === 'nevent') return { ids: [data.id], limit: 1 }
      if (type === 'naddr') {
        const pk = data.pubkey.toLowerCase()
        const ident = data.identifier ?? ''
        /** NIP-33 coordinate query; `#a` alone often misses — many relays index `authors` + `#d`. */
        return {
          kinds: [data.kind],
          authors: [pk],
          '#d': [ident],
          limit: 1
        }
      }
    } catch {
      /* invalid id */
    }
    return null
  }

  /**
   * Fetch event with external relays (hex, note1, nevent1, or naddr1)
   */
  async fetchEventWithExternalRelays(noteId: string, externalRelays: string[]): Promise<NEvent | undefined> {
    if (!externalRelays || externalRelays.length === 0) {
      logger.warn('fetchEventWithExternalRelays: No external relays provided', { noteId })
      return undefined
    }

    const filter = this.filterForExternalRelayFetch(noteId)
    if (!filter) {
      logger.warn('fetchEventWithExternalRelays: unparseable note id', {
        noteIdPrefix: noteId.slice(0, 24)
      })
      return undefined
    }

    const ingestOpts: ShouldDropEventOnIngestOptions | undefined =
      filter.ids?.length === 1 && /^[0-9a-f]{64}$/i.test(String(filter.ids[0]))
        ? { explicitNoteLookupHexId: String(filter.ids[0]).toLowerCase() }
        : undefined
    /** User-driven “try everywhere”: wait for EOSE-ish completion so slower relays (e.g. nos.lol) can answer. */
    const events = await this.queryService.query(externalRelays, filter, undefined, {
      eoseTimeout: EXTERNAL_RELAY_EVENT_FETCH_EOSE_TIMEOUT_MS,
      globalTimeout: EXTERNAL_RELAY_EVENT_FETCH_GLOBAL_TIMEOUT_MS,
      immediateReturn: false
    })

    const usable = events
      .filter((e) => !shouldDropEventOnIngest(e, ingestOpts))
      .sort((a, b) => b.created_at - a.created_at)
    return usable[0]
  }

  /**
   * Add event to session cache
   */
  addEventToCache(event: NEvent, ingestOpts?: ShouldDropEventOnIngestOptions): void {
    if (shouldDropEventOnIngest(event, ingestOpts)) return
    const cleanEvent = { ...event }
    delete (cleanEvent as any).relayStatuses
    // REQ filters and nip19 decode use lowercase hex; some relays/clients emit uppercase ids.
    // Session lookups and waiters must use the same canonical key or embeds miss events already on the timeline.
    const id =
      /^[0-9a-f]{64}$/i.test(cleanEvent.id) ? cleanEvent.id.toLowerCase() : cleanEvent.id
    if (id !== cleanEvent.id) {
      ;(cleanEvent as NEvent).id = id
    }
    this.sessionEventCache.set(id, cleanEvent as NEvent)
    if (cleanEvent.kind === kinds.Metadata) {
      const pk = cleanEvent.pubkey.toLowerCase()
      const prev = this.sessionMetadataByPubkey.get(pk)
      if (!prev || cleanEvent.created_at >= prev.created_at) {
        this.sessionMetadataByPubkey.set(pk, cleanEvent as NEvent)
      }
    }
    // NIP-65 (10002) and contacts (3) are not “document” replaceables; without this they never hit IndexedDB
    // from timeline/REQ ingest—only the logged-in account’s list was hydrated in NostrProvider / prewarm.
    if (
      (cleanEvent.kind === kinds.RelayList ||
        cleanEvent.kind === kinds.Contacts ||
        cleanEvent.kind === ExtendedKind.PAYMENT_INFO) &&
      indexedDb.hasReplaceableEventStoreForKind(cleanEvent.kind)
    ) {
      const coord = normalizeReplaceableCoordinateString(getReplaceableCoordinateFromEvent(cleanEvent as NEvent))
      const prev = this.ingestReplaceablePersistMaxCreatedAt.get(coord) ?? -1
      if (cleanEvent.created_at > prev) {
        this.ingestReplaceablePersistMaxCreatedAt.set(coord, cleanEvent.created_at)
        this.trimIngestReplaceablePersistMap()
        void client.replaceableEventService.updateReplaceableEventCache(cleanEvent as NEvent).catch(() => {})
      }
    }
    if (AUTHOR_CORE_PREFETCH_ON_INGEST_KINDS.has(cleanEvent.kind)) {
      const pk = cleanEvent.pubkey
      if (pk && /^[0-9a-f]{64}$/i.test(pk)) {
        void client.prefetchAuthorCoreReplaceables([pk.toLowerCase()])
      }
    }
    if (EMBEDDED_NOTE_PREFETCH_ON_INGEST_KINDS.has(cleanEvent.kind)) {
      this.prefetchEmbeddedEventsForParents([cleanEvent as NEvent])
    }
    this.notifySessionEventWaiters(id)
    this.notifyReplaceableCoordinateWaiters(cleanEvent as NEvent)
    queuePersistSeenEvent(cleanEvent as NEvent)
    if (isReplaceableEvent(cleanEvent.kind) && isDocumentRelayKind(cleanEvent.kind)) {
      const docCoord = normalizeReplaceableCoordinateString(getReplaceableCoordinateFromEvent(cleanEvent as NEvent))
      const docPrev = this.ingestReplaceablePersistMaxCreatedAt.get(docCoord) ?? -1
      if (cleanEvent.created_at > docPrev) {
        this.ingestReplaceablePersistMaxCreatedAt.set(docCoord, cleanEvent.created_at)
        this.trimIngestReplaceablePersistMap()
        void indexedDb.putReplaceableEvent(cleanEvent as NEvent).catch((error: unknown) => {
          const err = error instanceof Error ? error : new Error(String(error))
          const q = err.name === 'QuotaExceededError' || /quota|storage/i.test(err.message)
          if (q) {
            logger.debug('[EventService] Skipped document replaceable IndexedDB persist (storage quota)', {
              kind: cleanEvent.kind,
              eventId: id
            })
            return
          }
          logger.warn('[EventService] Failed to persist document replaceable to IndexedDB', {
            kind: cleanEvent.kind,
            eventId: id,
            errorMessage: err.message,
            errorName: err.name,
            error: err
          })
        })
      }
    }
    if (isCalendarEventKind(cleanEvent.kind)) {
      void indexedDb.putCalendarEventRow(cleanEvent as NEvent).catch((error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error))
        logger.debug('[EventService] Calendar event IndexedDB persist failed', {
          kind: cleanEvent.kind,
          eventId: id,
          errorMessage: err.message
        })
      })
    }
    if (cleanEvent.kind === ExtendedKind.CALENDAR_EVENT_RSVP) {
      void indexedDb.putCalendarRsvpEventRow(cleanEvent as NEvent).catch((error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error))
        logger.debug('[EventService] Calendar RSVP IndexedDB persist failed', {
          kind: cleanEvent.kind,
          eventId: id,
          errorMessage: err.message
        })
      })
    }
    if (cleanEvent.kind === ExtendedKind.PAYMENT_NOTIFICATION) {
      void indexedDb.putPaymentNotificationRow(cleanEvent as NEvent).catch((error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error))
        logger.debug('[EventService] Payment notification IndexedDB persist failed', {
          kind: cleanEvent.kind,
          eventId: id,
          errorMessage: err.message
        })
      })
    }
    if (cleanEvent.kind === ExtendedKind.PAYMENT_ATTESTATION) {
      void indexedDb.putPaymentAttestationRow(cleanEvent as NEvent).catch((error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error))
        logger.debug('[EventService] Payment attestation IndexedDB persist failed', {
          kind: cleanEvent.kind,
          eventId: id,
          errorMessage: err.message
        })
      })
    }
  }

  /** Apply {@link StorageKey.SESSION_EVENT_LRU_MAX} without reload (copies entries into a new LRU). */
  reapplySessionLruMax(): void {
    const max = getDefaultSessionLruMaxSync()
    const entries = [...this.sessionEventCache.entries()]
    this.sessionEventCache = new LRUCache<string, NEvent>({ max })
    for (const [k, v] of entries) {
      this.sessionEventCache.set(k, v)
    }
  }

  /** Kind 0 already ingested this session (e.g. from a timeline REQ). */
  getSessionMetadataForPubkey(hexPubkey: string): NEvent | undefined {
    const pk = hexPubkey.toLowerCase()
    const e = this.sessionMetadataByPubkey.get(pk)
    if (!e) return undefined
    if (shouldDropEventOnIngest(e)) {
      this.sessionMetadataByPubkey.delete(pk)
      return undefined
    }
    return e
  }

  /**
   * Session LRU only — for UI that must classify before async fetch (e.g. notification reactions).
   * Does not query IndexedDB or relays; {@link fetchEvent} remains authoritative when missing.
   */
  peekHexIdNoteFromSessionCache(hexId: string): NEvent | undefined {
    const id = hexId.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(id)) return undefined
    return this.getSessionEventIfAllowed(id, true)
  }

  /**
   * Pubkeys whose session-cached kind 0 matches a name / display_name / nip-05 substring (for search without IDB).
   */
  searchSessionProfilePubkeys(query: string, limit: number): string[] {
    const q = query.trim()
    if (!q || limit <= 0) return []
    const out: string[] = []
    for (const ev of this.sessionMetadataByPubkey.values()) {
      if (shouldDropEventOnIngest(ev)) continue
      if (out.length >= limit) break
      if (profileKind0MatchesSearchQuery(ev, q)) {
        out.push(ev.pubkey.toLowerCase())
      }
    }
    return out
  }

  /**
   * Get events from session cache matching search (newest {@link Event.created_at} first).
   * Scans up to {@link SESSION_SEARCH_MAX_SCAN} entries; only rows where {@link eventMatchesNip50LocalFullTextQuery}
   * matches the trimmed query are returned (not “recent rows” without a text hit).
   */
  getSessionEventsMatchingSearch(query: string, limit: number, allowedKinds?: number[]): NEvent[] {
    const queryTrim = query.trim()
    const kindSet = allowedKinds && allowedKinds.length > 0 ? new Set(allowedKinds) : null
    const buf: NEvent[] = []
    let scanned = 0

    // LRU order: most recently seen / published first (Map insertion order is not recency).
    for (const event of this.sessionEventCache.values()) {
      if (++scanned > SESSION_SEARCH_MAX_SCAN) break
      if (shouldDropEventOnIngest(event)) continue
      if (kindSet && !kindSet.has(event.kind)) continue

      if (queryTrim === '') {
        buf.push(event)
        continue
      }

      if (eventMatchesNip50LocalFullTextQuery(event, queryTrim)) {
        buf.push(event)
      }
    }

    buf.sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))
    return buf.slice(0, limit)
  }

  getSessionEventsMatchingFilters(filters: readonly Filter[], limit: number): NEvent[] {
    if (filters.length === 0 || limit <= 0) return []
    const cappedLimit = Math.min(Math.max(limit, 1), 8000)
    const results: NEvent[] = []
    for (const [, event] of this.sessionEventCache.entries()) {
      if (shouldDropEventOnIngest(event)) continue
      if (!eventMatchesAnyLocalFeedFilter(event, filters)) continue
      results.push(event)
      if (results.length >= cappedLimit) break
    }
    results.sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))
    return results
  }

  /**
   * Session LRU: events authored by `authorPubkey` (e.g. notes, reposts, reactions) for local aggregates.
   */
  listSessionEventsAuthoredBy(
    authorPubkey: string,
    opts?: { kinds?: readonly number[]; limit?: number }
  ): NEvent[] {
    const pk = authorPubkey.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(pk)) return []
    const kindSet = opts?.kinds?.length ? new Set(opts.kinds) : null
    const limit = Math.min(Math.max(opts?.limit ?? 800, 1), 4000)
    const out: NEvent[] = []
    for (const [, event] of this.sessionEventCache.entries()) {
      if (shouldDropEventOnIngest(event)) continue
      if (event.pubkey.toLowerCase() !== pk) continue
      if (kindSet && !kindSet.has(event.kind)) continue
      out.push(event)
      if (out.length >= limit) break
    }
    out.sort((a, b) => b.created_at - a.created_at)
    return out
  }

  /**
   * Session LRU: events of the given `kinds` from this tab session, optionally `created_at >= since`, newest first.
   * Used with IndexedDB + relays for aggregates (e.g. thread heat map) without depending on relay order alone.
   */
  listSessionEventsByKinds(kinds: readonly number[], opts?: { since?: number; limit?: number }): NEvent[] {
    const kindSet = new Set(kinds)
    const since = opts?.since
    const limit = Math.min(Math.max(opts?.limit ?? 2000, 1), 8000)
    const buf: NEvent[] = []
    for (const [, event] of this.sessionEventCache.entries()) {
      if (shouldDropEventOnIngest(event)) continue
      if (!kindSet.has(event.kind)) continue
      if (since !== undefined && event.created_at < since) continue
      buf.push(event)
    }
    buf.sort((a, b) => b.created_at - a.created_at)
    return buf.slice(0, limit)
  }

  /**
   * Session cache: NIP-32 citation kinds (30–33) matched on title/summary/content and related tags
   * (not NIP-50 relay semantics).
   */
  getSessionCitationFieldSearch(query: string, limit: number): NEvent[] {
    const results: NEvent[] = []
    const q = query.trim()
    if (!q || limit <= 0) return results

    const kindSet = new Set<number>([
      ExtendedKind.CITATION_INTERNAL,
      ExtendedKind.CITATION_EXTERNAL,
      ExtendedKind.CITATION_HARDCOPY,
      ExtendedKind.CITATION_PROMPT
    ])

    for (const [, event] of this.sessionEventCache.entries()) {
      if (shouldDropEventOnIngest(event)) continue
      if (!kindSet.has(event.kind)) continue
      if (!citationPickerMatchesQuery(event, q)) continue
      results.push(event)
      if (results.length >= limit) break
    }

    return results
  }

  /**
   * Kind 9735 in session LRU whose top-level `e` references the given hex event id (e.g. zap poll / note).
   * Used to show tally immediately when opening the note drawer after the feed already saw these receipts.
   */
  getSessionZapReceiptsForTargetEventId(targetEventHexId: string): NEvent[] {
    const id = targetEventHexId.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(id)) return []
    const out: NEvent[] = []
    for (const [, event] of this.sessionEventCache.entries()) {
      if (event.kind !== kinds.Zap) continue
      if (shouldDropEventOnIngest(event)) continue
      const matches = event.tags.some(
        (t) => (t[0] === 'e' || t[0] === 'E') && t[1]?.toLowerCase() === id
      )
      if (matches) out.push(event)
    }
    return out
  }

  /**
   * Session LRU rows that already reference `rootEvent` for {@link NoteStatsService} (reposts, reactions, zaps,
   * replies, quotes, etc.). Iteration is recency-ordered; only the first {@link NOTE_STATS_SESSION_PREMERGE_SCAN_MAX}
   * rows are scanned so large session caps do not stall stats batches.
   */
  getSessionEventsForNoteStatsTarget(rootEvent: NEvent, options?: { maxScan?: number }): NEvent[] {
    const maxScan = Math.min(Math.max(options?.maxScan ?? NOTE_STATS_SESSION_PREMERGE_SCAN_MAX, 200), 40_000)
    const id = rootEvent.id.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(id)) return []

    const coordRaw = isReplaceableEvent(rootEvent.kind)
      ? getReplaceableCoordinateFromEvent(rootEvent)?.trim()
      : undefined
    const coordNorm = coordRaw ? normalizeReplaceableCoordinateString(coordRaw) : undefined

    const kindAllow = new Set<number>([
      kinds.Reaction,
      kinds.Repost,
      ExtendedKind.GENERIC_REPOST,
      kinds.Zap,
      kinds.ShortTextNote,
      ExtendedKind.COMMENT,
      ExtendedKind.VOICE_COMMENT,
      kinds.Highlights,
      ExtendedKind.EXTERNAL_REACTION,
      ExtendedKind.WEB_BOOKMARK,
      ...NOTE_STATS_OP_REFERENCE_KINDS_WITHOUT_HIGHLIGHT
    ])

    const hexMatchesRoot = (hex: string | undefined) => {
      if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) return false
      return hex.toLowerCase() === id
    }

    const coordMatches = (atag: string | undefined) => {
      if (!coordNorm || !atag?.trim()) return false
      return normalizeReplaceableCoordinateString(atag) === coordNorm
    }

    const out: NEvent[] = []
    let scanned = 0
    for (const [, event] of this.sessionEventCache.entries()) {
      if (++scanned > maxScan) break
      if (shouldDropEventOnIngest(event)) continue
      if (!kindAllow.has(event.kind)) continue

      let hit = false
      for (const t of event.tags) {
        const name = t[0]
        const v = t[1]?.trim()
        if (!v) continue
        if (name === 'e' || name === 'E') {
          if (hexMatchesRoot(v)) {
            hit = true
            break
          }
        } else if (name === 'q') {
          if (hexMatchesRoot(v)) {
            hit = true
            break
          }
        } else if (name === 'a' || name === 'A') {
          if (coordMatches(v)) {
            hit = true
            break
          }
        }
      }
      if (hit) out.push(event)
    }
    out.sort((a, b) => b.created_at - a.created_at)
    return out
  }

  /**
   * Kind 31925 in session LRU for this calendar replaceable: `a` coordinate match, or `e` pointing at this
   * revision’s id (some clients tag the instance id only). Used so RSVP lists populate from feeds before
   * IndexedDB / relay REQ complete.
   */
  getSessionCalendarRsvpsForCalendarEvent(calendarEvent: NEvent): NEvent[] {
    if (!isCalendarEventKind(calendarEvent.kind)) return []
    const coordNorm = normalizeReplaceableCoordinateString(
      getReplaceableCoordinateFromEvent(calendarEvent)
    )
    const calId = /^[0-9a-f]{64}$/i.test(calendarEvent.id)
      ? calendarEvent.id.toLowerCase()
      : calendarEvent.id
    const out: NEvent[] = []
    for (const [, event] of this.sessionEventCache.entries()) {
      if (event.kind !== ExtendedKind.CALENDAR_EVENT_RSVP) continue
      if (shouldDropEventOnIngest(event)) continue
      const rawA = event.tags.find(tagNameEquals('a'))?.[1]?.trim()
      if (rawA && normalizeReplaceableCoordinateString(rawA) === coordNorm) {
        out.push(event)
        continue
      }
      const eTag = event.tags.find(tagNameEquals('e'))?.[1]?.trim().toLowerCase()
      if (eTag && /^[0-9a-f]{64}$/.test(eTag) && eTag === calId) {
        out.push(event)
      }
    }
    return out.sort((a, b) => b.created_at - a.created_at)
  }

  /**
   * WebSocket relay URLs from `e`-tag position 3 on session-cached events that reference this hex id.
   * Reactions often carry the publisher’s relay hint; without it, note-stats may miss kind 7 that never reached index relays.
   */
  getSessionRelayHintsForHexTarget(targetHexId: string): string[] {
    const id = targetHexId.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(id)) return []
    const hints = new Set<string>()
    for (const [, event] of this.sessionEventCache.entries()) {
      if (shouldDropEventOnIngest(event)) continue
      for (const t of event.tags) {
        if (t[0] !== 'e' && t[0] !== 'E') continue
        if (t[1]?.toLowerCase() !== id) continue
        const raw = t[2]?.trim()
        if (!raw) continue
        const n = normalizeUrl(raw)
        if (n) hints.add(n)
      }
    }
    return [...hints]
  }

  /**
   * Reply-shaped events already in the session LRU for this thread (notes, kind 1111, voice comments, zaps),
   * found by BFS over e/E/q and (for `a`-root threads) a-tag links. Merges with relay fetches via ReplyProvider.
   */
  getSessionThreadInteractionEvents(
    root: { type: 'E'; id: string } | { type: 'A'; id: string; eventId: string } | { type: 'I'; id: string },
    openNoteHexId?: string
  ): NEvent[] {
    if (root.type === 'I') return []

    const threadKeys = new Set<string>()
    const openHex = openNoteHexId?.trim().toLowerCase()
    if (openHex && /^[0-9a-f]{64}$/.test(openHex)) {
      threadKeys.add(openHex)
    }
    if (root.type === 'E') {
      const id = root.id.trim().toLowerCase()
      if (!/^[0-9a-f]{64}$/.test(id)) return []
      threadKeys.add(id)
    } else {
      threadKeys.add(root.id.trim().toLowerCase())
      const aid = root.eventId.trim().toLowerCase()
      if (/^[0-9a-f]{64}$/.test(aid)) threadKeys.add(aid)
    }

    const linkRefs = (ev: NEvent): string[] => {
      const ids = new Set<string>()
      const add = (v?: string) => {
        if (v == null || v === '') return
        ids.add(v.trim().toLowerCase())
      }
      add(getParentETag(ev)?.[1])
      add(getRootETag(ev)?.[1])
      const qref = getQuotedReferenceFromQTags(ev)
      add(qref?.hexId)
      add(qref?.coordinate)
      if (ev.kind === kinds.Zap || isNip18RepostKind(ev.kind)) {
        add(getFirstHexEventIdFromETags(ev.tags))
      }
      if (
        ev.kind === kinds.ShortTextNote ||
        ev.kind === ExtendedKind.COMMENT ||
        ev.kind === ExtendedKind.VOICE_COMMENT
      ) {
        for (const t of ev.tags) {
          if ((t[0] === 'e' || t[0] === 'E') && t[1]) add(t[1])
        }
      }
      if (root.type === 'A') {
        add(getRootATag(ev)?.[1])
        add(getParentATag(ev)?.[1])
        for (const t of ev.tags) {
          if ((t[0] === 'a' || t[0] === 'A') && t[1]) add(t[1])
        }
      }
      return [...ids]
    }

    const seen = new Set<string>()
    const out: NEvent[] = []
    const maxRounds = 14
    for (let round = 0; round < maxRounds; round++) {
      let added = 0
      for (const [, ev] of this.sessionEventCache.entries()) {
        if (shouldDropEventOnIngest(ev)) continue
        if (isNip18RepostKind(ev.kind)) continue
        const threadishKind1Quote =
          (root.type === 'E' || root.type === 'A') && kind1QuotesThreadRoot(ev, root)
        if (!isReplyNoteEvent(ev) && !threadishKind1Quote && !isNip25ReactionKind(ev.kind))
          continue
        if (seen.has(ev.id)) continue
        if (!linkRefs(ev).some((id) => threadKeys.has(id))) continue
        out.push(ev)
        seen.add(ev.id)
        added++
        const eid = ev.id.trim().toLowerCase()
        if (/^[0-9a-f]{64}$/.test(eid)) threadKeys.add(eid)
        if (root.type === 'A') {
          for (const t of ev.tags) {
            if ((t[0] === 'a' || t[0] === 'A') && t[1]) {
              threadKeys.add(t[1].trim().toLowerCase())
            }
          }
        }
      }
      if (added === 0) break
    }
    return out
  }

  /**
   * Extract relay hints from event tags
   * Relay hints are in the 3rd position (index 2) of e, a, q, etc. tags
   * Also checks for a dedicated "relays" tag
   */
  private extractRelayHintsFromEvent(event: NEvent | undefined): string[] {
    if (!event) return []
    const hints = new Set<string>()
    
    // Extract from e, a, q tags (relay hint is in position 2, index 2)
    const tagTypesWithRelayHints = ['e', 'a', 'q']
    for (const tag of event.tags) {
      if (tagTypesWithRelayHints.includes(tag[0]) && tag.length > 2 && typeof tag[2] === 'string') {
        const hint = tag[2]
        if (
          (hint.startsWith('wss://') || hint.startsWith('ws://')) &&
          urlIsNonLocalForRemoteViewer(hint)
        ) {
          hints.add(hint)
        }
      }
    }

    // Also check for dedicated "relays" tag
    const relaysTag = event.tags.find((tag) => tag[0] === 'relays')
    if (relaysTag && relaysTag.length > 1) {
      relaysTag.slice(1).forEach((url) => {
        if (
          typeof url === 'string' &&
          (url.startsWith('wss://') || url.startsWith('ws://')) &&
          urlIsNonLocalForRemoteViewer(url)
        ) {
          hints.add(url)
        }
      })
    }

    return Array.from(hints)
  }

  /**
   * Clear all in-memory event caches
   */
  clearCaches(): void {
    this.eventDataLoader.clearAll()
    this.sessionEventCache.clear()
    this.sessionMetadataByPubkey.clear()
    this.eventCacheMap.clear()
    this.sessionEventWaiters.clear()
    this.sessionReplaceableWaiters.clear()
    this.fetchEventFromBigRelaysDataloader.clearAll()
    invalidateArchiveFootprintCache()
    logger.info('[EventService] In-memory caches cleared')
  }

  /**
   * Private: Fetch event by ID (internal implementation)
   */
  private async _fetchEvent(
    id: string,
    extraRelayHints?: string[],
    threadContext = false
  ): Promise<NEvent | undefined> {
    let filter: Filter | undefined
    let relays: string[] = []
    let authorHintPubkey: string | undefined
    const normalizeRelayList = (urls: string[]) =>
      sanitizeRelayUrlsForFetch(
        [...new Set(urls.map((u) => normalizeUrl(u)).filter((u): u is string => Boolean(u)))]
      )
    if (extraRelayHints?.length) {
      relays = normalizeRelayList(prependAggrForEventLookupRelayUrls(extraRelayHints))
    }

    if (/^[0-9a-f]{64}$/i.test(id)) {
      filter = { ids: [id.toLowerCase()], limit: 1 }
    } else {
      const { type, data } = nip19.decode(id)
      switch (type) {
        case 'note':
          filter = { ids: [data], limit: 1 }
          break
        case 'nevent':
          filter = { ids: [data.id], limit: 1 }
          if (data.relays) relays = normalizeRelayList([...relays, ...data.relays])
          if (data.author && /^[0-9a-f]{64}$/i.test(data.author)) {
            authorHintPubkey = data.author.toLowerCase()
          }
          break
        case 'naddr': {
          const pk = data.pubkey.toLowerCase()
          const ident = data.identifier ?? ''
          filter = {
            kinds: [data.kind],
            authors: [pk],
            '#d': [ident],
            limit: 1
          }
          if (data.relays) relays = normalizeRelayList([...relays, ...data.relays])
          break
        }
      }
    }

    if (!filter) return undefined

    const ingestHexForIdFetch =
      filter.ids?.length === 1 &&
      typeof filter.ids[0] === 'string' &&
      /^[0-9a-f]{64}$/i.test(filter.ids[0])
        ? filter.ids[0].toLowerCase()
        : undefined
    const ingestOpts: ShouldDropEventOnIngestOptions | undefined = ingestHexForIdFetch
      ? { explicitNoteLookupHexId: ingestHexForIdFetch }
      : undefined

    if (filter.ids?.length === 1) {
      const hid = filter.ids[0]!.toLowerCase()
      if (/^[0-9a-f]{64}$/.test(hid)) {
        const fromArchive = await loadArchivedEventForFetch(hid)
        if (fromArchive && !shouldDropEventOnIngest(fromArchive, ingestOpts)) {
          this.addEventToCache(fromArchive, ingestOpts)
          return fromArchive
        }
      }
    }

    // Try cache first
    if (filter.ids?.length) {
      const cached = await indexedDb.getEventFromPublicationStore(filter.ids[0])
      if (cached && !shouldDropEventOnIngest(cached, ingestOpts)) {
        this.addEventToCache(cached, ingestOpts)
        // Extract relay hints from cached event's tags (e, a, q tags)
        const eventRelayHints = this.extractRelayHintsFromEvent(cached)
        if (eventRelayHints.length > 0) {
          relays = normalizeRelayList([...relays, ...eventRelayHints])
        }
        return cached
      }
    }

    if (
      filter.authors?.length === 1 &&
      filter.kinds?.length === 1 &&
      Array.isArray(filter['#d']) &&
      filter['#d'].length >= 1
    ) {
      const pk = filter.authors[0]!.trim().toLowerCase()
      const kind = filter.kinds[0]!
      const dTag = String(filter['#d'][0] ?? '').trim()
      if (pk && dTag) {
        try {
          const cached = await indexedDb.getReplaceableEvent(pk, kind, dTag)
          if (cached && cached.kind === kind && !shouldDropEventOnIngest(cached, ingestOpts)) {
            this.addEventToCache(cached, ingestOpts)
            return cached
          }
        } catch {
          /* optional */
        }
      }
    }

    if (relays.length > 0) {
      const hintedEvents = await this.queryService.query(relays, filter, undefined, {
        immediateReturn: true,
        eoseTimeout: HINTED_EVENT_FETCH_EOSE_TIMEOUT_MS,
        globalTimeout: HINTED_EVENT_FETCH_GLOBAL_TIMEOUT_MS
      })
      const hinted = hintedEvents
        .filter((e) => !shouldDropEventOnIngest(e, ingestOpts))
        .sort((a, b) => b.created_at - a.created_at)[0]
      if (hinted) {
        this.addEventToCache(hinted, ingestOpts)
        return hinted
      }
    }

    // Try big relays first (uses user's inboxes + defaults)
    if (filter.ids?.length) {
      const event = await this.fetchEventFromBigRelaysDataloader.load(filter.ids[0])
      if (event && !shouldDropEventOnIngest(event, ingestOpts)) {
        this.addEventToCache(event, ingestOpts)
        // Extract relay hints from found event's tags (e, a, q tags)
        const eventRelayHints = this.extractRelayHintsFromEvent(event)
        if (eventRelayHints.length > 0) {
          relays = normalizeRelayList([...relays, ...eventRelayHints])
        }
        return event
      }
    }

    // Always try comprehensive relay list (author's outboxes + user's inboxes + hints + seen + defaults)
    const event = await this.tryHarderToFetchEvent(
      relays,
      filter,
      true,
      authorHintPubkey,
      ingestOpts,
      threadContext
    )
    if (event && !shouldDropEventOnIngest(event, ingestOpts)) {
      this.addEventToCache(event, ingestOpts)
      return event
    }

    // Another code path (e.g. feed prefetch) may have populated session while we were in-flight.
    if (filter.ids?.length === 1) {
      const raw = filter.ids[0]
      const key = /^[0-9a-f]{64}$/i.test(raw) ? raw.toLowerCase() : raw
      const sess = this.getSessionEventIfAllowed(key, true)
      if (sess) return sess
    }

    if (filter.authors?.length === 1 && filter.kinds?.length === 1 && Array.isArray(filter['#d'])) {
      const ident = filter['#d'][0] ?? ''
      const sessAddr = this.getSessionEventIfMatchingNaddr({
        pubkey: filter.authors[0]!,
        kind: filter.kinds[0]!,
        identifier: ident
      })
      if (sessAddr) return sessAddr
    }

    if (Array.isArray(filter['#a']) && filter['#a'][0]) {
      const parsed = parseReplaceableAtagCoordinate(String(filter['#a'][0]))
      if (parsed) {
        const sessA = this.getSessionEventIfMatchingNaddr({
          pubkey: parsed.pubkey,
          kind: parsed.kind,
          identifier: parsed.identifier
        })
        if (sessA) return sessA
      }
    }

    return undefined
  }

  /**
   * Private: Try harder to fetch event from relays
   * Uses: hints, seen, author relays when known, user's inboxes + cache, fast read + searchable relays.
   */
  private async tryHarderToFetchEvent(
    relayHints: string[],
    filter: Filter,
    alreadyFetchedFromBigRelays = false,
    authorHintPubkey?: string,
    ingestOpts?: ShouldDropEventOnIngestOptions,
    threadContext = false
  ): Promise<NEvent | undefined> {
    // Get seen relays if we have an event ID
    const seenRelays = filter.ids?.length ? client.getSeenEventRelayUrls(filter.ids[0]) : []
    
    const parsedAtag =
      Array.isArray(filter['#a']) && typeof filter['#a'][0] === 'string'
        ? parseReplaceableAtagCoordinate(filter['#a'][0] as string)
        : null
    const authorPubkey =
      filter.authors?.length === 1 ? filter.authors[0] : parsedAtag?.pubkey ?? authorHintPubkey

    // Build comprehensive relay list
    const relayUrls = await buildComprehensiveRelayListForEvents(authorPubkey, relayHints, seenRelays, [])
    
    if (!relayUrls.length) {
      // Fallback to default relays if comprehensive list is empty
      if (!alreadyFetchedFromBigRelays) {
        return undefined
      }
      return undefined
    }

    const isSingleEventById = Boolean(filter.ids && filter.ids.length === 1 && filter.limit === 1)
    /** Replaceable coordinate: `#a` (preferred) or legacy `authors` + `#d`. */
    const isReplaceableCoordinateFetch =
      filter.limit === 1 &&
      filter.kinds?.length === 1 &&
      ((Array.isArray(filter['#a']) && filter['#a'].length >= 1) ||
        (filter.authors?.length === 1 && Array.isArray(filter['#d']) && filter['#d'].length >= 1))
    const useFastSingleHitQuery = isSingleEventById || isReplaceableCoordinateFetch

    const tryHarderGlobalTimeout = threadContext
      ? THREAD_CONTEXT_TRY_HARDER_GLOBAL_TIMEOUT_MS
      : useFastSingleHitQuery
        ? SINGLE_EVENT_BY_ID_QUERY_GLOBAL_TIMEOUT_MS
        : 10000
    const events = await this.queryService.query(relayUrls, filter, undefined, {
      immediateReturn: useFastSingleHitQuery,
      eoseTimeout: useFastSingleHitQuery ? SINGLE_EVENT_BY_ID_QUERY_EOSE_TIMEOUT_MS : 500,
      globalTimeout: tryHarderGlobalTimeout
    })

    const event = events
      .filter((e) => !shouldDropEventOnIngest(e, ingestOpts))
      .sort((a, b) => b.created_at - a.created_at)[0]

    return event
  }

  /**
   * Private: Fetch events from big relays (batch)
   * Uses same comprehensive list as single-event fetch (inboxes, fast read, searchable, cache).
   */
  private async fetchEventsFromBigRelays(ids: readonly string[]): Promise<(NEvent | undefined)[]> {
    const normalized = ids.map((id) => (/^[0-9a-f]{64}$/i.test(id) ? id.toLowerCase() : id))
    const fromSession = normalized.map((k) => this.getSessionEventIfAllowed(k))
    const missingIndices: number[] = []
    for (let i = 0; i < normalized.length; i++) {
      if (!fromSession[i]) missingIndices.push(i)
    }
    if (missingIndices.length === 0) {
      return fromSession as NEvent[]
    }

    // Build comprehensive relay list (user's inboxes + defaults)
    // Note: For batch fetches, we don't have author info, so we use user's inboxes + defaults
    const relayUrls = await buildComprehensiveRelayListForEvents(undefined, [], [], [])

    const missingIds = missingIndices.map((i) => normalized[i]!)
    const isSingleEventFetch = missingIds.length === 1
    const batchIngestOpts: ShouldDropEventOnIngestOptions | undefined =
      isSingleEventFetch && /^[0-9a-f]{64}$/i.test(missingIds[0]!)
        ? { explicitNoteLookupHexId: missingIds[0]!.toLowerCase() }
        : undefined
    // For single-event fetches, always use immediateReturn to return ASAP
    // This is especially important for non-replaceable events (not in 10000-19999 or 30000-39999 ranges)
    const events = await this.queryService.query(
      relayUrls,
      {
        ids: Array.from(new Set(missingIds)),
        limit: missingIds.length
      },
      undefined,
      {
        immediateReturn: isSingleEventFetch,
        eoseTimeout: isSingleEventFetch ? SINGLE_EVENT_BY_ID_QUERY_EOSE_TIMEOUT_MS : 500,
        globalTimeout: isSingleEventFetch ? SINGLE_EVENT_BY_ID_QUERY_GLOBAL_TIMEOUT_MS : 10000
      }
    )

    const fetchedById = new Map<string, NEvent>()
    for (const event of events) {
      if (shouldDropEventOnIngest(event, batchIngestOpts)) continue
      const key = /^[0-9a-f]{64}$/i.test(event.id) ? event.id.toLowerCase() : event.id
      fetchedById.set(key, event)
      this.addEventToCache(event, batchIngestOpts)
    }

    return normalized.map((k, i) => fromSession[i] ?? fetchedById.get(k))
  }
}
