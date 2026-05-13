import {
  FAST_READ_RELAY_URLS,
  FEED_FIRST_RELAY_RESULT_GRACE_MIN_LIMIT,
  FIRST_RELAY_RESULT_GRACE_MS,
  relayFilterIncludesSocialKindBlockedKind,
  relaysAfterSocialKindBlockedStrip,
  SOCIAL_KIND_BLOCKED_RELAY_URLS,
  MAX_CONCURRENT_RELAY_CONNECTIONS,
  MAX_CONCURRENT_SUBS_PER_RELAY,
  PROFILE_RELAY_URLS,
  RELAY_FILTER_MAX_KINDS_PER_OBJECT,
  RELAY_REQ_MAX_FILTERS_PER_MESSAGE,
  RELAY_POOL_CONNECTION_TIMEOUT_MS,
  SEARCHABLE_RELAY_URLS
} from '@/constants'
import {
  relayFiltersUseCapitalLetterTagKeys,
  relayUrlsStripExtendedTagReqBlocked
} from '@/lib/relay-extended-tag-req-blocks'
import { shouldDropEventOnIngest } from '@/lib/event-ingest-filter'
import { relaySessionStrikes } from '@/lib/relay-strikes'
import { queueRelayAuthSign } from '@/lib/relay-auth-sign-queue'
import {
  authenticateNip42Relay,
  isRelayAuthRequiredCloseReason,
  isRelaySubscriptionClosedByCaller
} from '@/lib/relay-nip42-auth'
import { applyRelayNip42AckTimeout } from '@/lib/relay-nip42-tuning'
import { isIndexRelayTransportFailure, queryIndexRelay } from '@/lib/index-relay-http'
import logger from '@/lib/logger'
import { isHttpRelayUrl, normalizeHttpRelayUrl, normalizeUrl } from '@/lib/url'
import { RelaySubscribeOpBatch, type RelayOpTerminalRow } from '@/services/relay-operation-log.service'
import { patchRelayNoticeForFetchFailures } from '@/services/relay-notice-fetch-failure'
import type { Filter, Event as NEvent } from 'nostr-tools'
import { SimplePool, EventTemplate, VerifiedEvent, nip19 } from 'nostr-tools'
import type { AbstractRelay } from 'nostr-tools/abstract-relay'
import nip66Service from './nip66.service'
import type { ISigner, TSignerType } from '@/types'

/** NIP-01 filter keys only; NIP-50 adds `search` which non-searchable relays reject. */
function filterForRelay(f: Filter, relaySupportsSearch: boolean): Filter {
  if (relaySupportsSearch) return f
  const rest = { ...f }
  delete rest.search
  return rest as Filter
}

function filtersHaveNip50Search(filters: readonly Filter[]): boolean {
  return filters.some((f) => typeof f.search === 'string' && f.search.trim().length > 0)
}

/** NIP-50 index relays answer after connect + slot wait; nostr-tools synthetic EOSE runs this long after REQ `fire()`. */
const NIP50_RELAY_SUBSCRIPTION_EOSE_TIMEOUT_MS = 38_000
/**
 * {@link QueryService.query} `globalTimeout` is armed at call start; REQ may start seconds later. Used only for
 * {@link ClientService.fetchEventsFromSingleRelay} so mention/picker queries keep their own shorter caps.
 */
const NIP50_QUERY_GLOBAL_TIMEOUT_FLOOR_MS = 42_000

const HEX_EVENT_ID_RE = /^[0-9a-f]{64}$/i

let queryReqSeq = 0

function logQueryReqConsolidatedEnd(
  reqId: number,
  source: string,
  inputRelays: string[],
  httpBases: string[],
  events: NEvent[],
  terminals: RelayOpTerminalRow[],
  getSeenForEvent: (eventId: string) => string[]
): void {
  const kindHistogram: Record<string, number> = {}
  for (const e of events) {
    const k = String(e.kind)
    kindHistogram[k] = (kindHistogram[k] ?? 0) + 1
  }

  const outcomeCounts: Record<string, number> = {}
  for (const t of terminals) {
    const k = t.outcome
    outcomeCounts[k] = (outcomeCounts[k] ?? 0) + 1
  }
  const benignEmpty =
    events.length === 0 &&
    (terminals.length === 0 ||
      terminals.every((t) => t.outcome === 'eose'))
  if (benignEmpty) {
    return
  }

  const relayTotal = new Set([
    ...inputRelays.map((u) => normalizeUrl(u) || u),
    ...httpBases.map((u) => normalizeUrl(u) || u)
  ]).size

  let relaysWithHits = 0
  if (events.length > 0) {
    const hitUrls = new Set<string>()
    for (const e of events) {
      for (const u of getSeenForEvent(e.id)) {
        hitUrls.add(normalizeUrl(u) || u)
      }
    }
    relaysWithHits = hitUrls.size
  }

  logger.debug('[QueryService] req_end', {
    reqId,
    source,
    eventCount: events.length,
    kindHistogram,
    relayCandidateCount: relayTotal,
    terminalCount: terminals.length,
    terminalOutcomes: outcomeCounts,
    relaysWithEventHits: relaysWithHits
  })
}

function decodeEventRefForETagFilter(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const withoutPrefix = trimmed.toLowerCase().startsWith('nostr:') ? trimmed.slice(6).trim() : trimmed
  if (HEX_EVENT_ID_RE.test(withoutPrefix)) return withoutPrefix.toLowerCase()
  try {
    const decoded = nip19.decode(withoutPrefix)
    if (decoded.type === 'note') return decoded.data
    if (decoded.type === 'nevent') return decoded.data.id
  } catch {
    /* ignore */
  }
  return null
}

function sanitizeETagFilter(filter: Filter): Filter | null {
  const f = { ...filter } as Filter & { '#e'?: string[]; '#E'?: string[] }
  const rawLower = Array.isArray(f['#e']) ? f['#e'] : []
  const rawUpper = Array.isArray(f['#E']) ? f['#E'] : []
  if (rawLower.length === 0 && rawUpper.length === 0) return f
  const rawAll = [...rawLower, ...rawUpper]
  const decoded = [
    ...new Set(
      rawAll
        .map((v) => decodeEventRefForETagFilter(String(v)))
        .filter((v): v is string => !!v)
    )
  ]
  if (import.meta.env.DEV && decoded.length !== rawAll.length) {
    const invalidSample = rawAll
      .map((v) => String(v))
      .filter((v) => !decodeEventRefForETagFilter(v))
      .slice(0, 3)
    logger.info('[QueryService] sanitized invalid #e/#E refs before REQ', {
      inputCount: rawAll.length,
      decodedCount: decoded.length,
      invalidSample
    })
  }
  if (decoded.length === 0) return null
  f['#e'] = decoded
  delete f['#E']
  return f
}

/** Relays often cap kinds-per-filter; duplicate the filter with chunked `kinds` so REQs are not dropped. */
function splitFiltersByMaxKindCount(filters: Filter[]): Filter[] {
  const max = RELAY_FILTER_MAX_KINDS_PER_OBJECT
  if (max <= 0) return filters
  const out: Filter[] = []
  for (const f of filters) {
    const k = f.kinds
    if (!Array.isArray(k) || k.length <= max) {
      out.push(f)
      continue
    }
    for (let i = 0; i < k.length; i += max) {
      out.push({ ...f, kinds: k.slice(i, i + max) })
    }
  }
  return out
}

function sanitizeFiltersBeforeReq(filter: Filter | Filter[]): Filter[] {
  const asArray = Array.isArray(filter) ? filter : [filter]
  const sanitized = asArray.map(sanitizeETagFilter).filter((f): f is Filter => !!f)
  return splitFiltersByMaxKindCount(sanitized)
}

/** True for single-replaceable REQ (`#a` coordinate or legacy `authors` + `#d`). */
function filterHasReplaceableCoordinate(f: Filter): boolean {
  if ((f.limit ?? 0) !== 1 || !f.kinds?.length) return false
  const a = (f as Record<string, unknown>)['#a']
  if (Array.isArray(a) && a.length > 0 && typeof a[0] === 'string' && String(a[0]).includes(':')) {
    return true
  }
  if (f.authors?.length === 1) {
    const d = (f as Record<string, unknown>)['#d']
    return Array.isArray(d) && d.length > 0
  }
  return false
}

function someFilterHasReplaceableCoordinate(filters: Filter[]): boolean {
  return filters.some(filterHasReplaceableCoordinate)
}

export interface QueryOptions {
  eoseTimeout?: number
  globalTimeout?: number
  /** For replaceable events: race strategy - wait after first result, then return best (per author when batching) */
  replaceableRace?: boolean
  /** Ms to wait after the first event when replaceableRace is true (lets other relays return a newer version) */
  replaceableRaceWaitMs?: number
  /** For non-replaceable single events: return immediately on first match */
  immediateReturn?: boolean
  /**
   * Multi-relay feed / batch: after first event, wait this many ms then close and return.
   * `false` disables (wait for normal EOSE / global timeout). When omitted, implicit grace uses
   * {@link FIRST_RELAY_RESULT_GRACE_MS} only if the largest filter `limit` is at least
   * {@link FEED_FIRST_RELAY_RESULT_GRACE_MIN_LIMIT} (and not replaceableRace / immediateReturn / single-event fetch).
   */
  firstRelayResultGraceMs?: number | false
  /** Label for {@link RelaySubscribeOpBatch} when this query opens REQs. */
  relayOpSource?: string
  /**
   * When aborted (e.g. React effect cleanup / HMR), closes WS + HTTP index work promptly instead of waiting for
   * {@link globalTimeout}. Prevents overlapping NIP-50 shards from stacking until the tab OOMs.
   */
  signal?: AbortSignal
  /**
   * When true, this query ignores {@link QueryService.interruptBackgroundQueries} (e.g. NIP-50 shard with its own
   * AbortController, or other foreground work that must not be tied to the global background token).
   */
  foreground?: boolean
}

export interface SubscribeCallbacks {
  onevent?: (evt: NEvent) => void
  oneose?: (eosed: boolean) => void
  onclose?: (url: string, reason: string) => void
  startLogin?: () => void
  onAllClose?: (reasons: string[]) => void
}

export type QueryServiceRelaySessionOptions = {
  /** NOTICE "failed to fetch events" and similar backend failures. */
  onRelayNoticeFetchFailure?: (normalizedUrl: string, noticeMessage: string) => void
}

export class QueryService {
  private pool: SimplePool
  private signer?: ISigner
  private signerType?: TSignerType
  /** Optional: ingest every resolved `query()` result (e.g. session event LRU). */
  private onQueryResultIngest?: (events: NEvent[]) => void
  private onRelayNoticeFetchFailure?: (normalizedUrl: string, noticeMessage: string) => void

  /** Max concurrent REQ subscriptions per relay URL (see {@link MAX_CONCURRENT_SUBS_PER_RELAY}). */
  private static readonly SUB_SLOT_CAP_PER_RELAY = MAX_CONCURRENT_SUBS_PER_RELAY
  private activeSubCountByRelay = new Map<string, number>()
  private subSlotWaitQueueByRelay = new Map<string, Array<() => void>>()
  private eventSeenOnRelays = new Map<string, Set<string>>()

  /** App-wide cap on parallel ensureRelay + initial subscribe setup (any relay). */
  private globalRelayConnectionSlotsInUse = 0
  private globalRelayConnectionWaitQueue: Array<() => void> = []

  /**
   * Aborted whenever {@link interruptBackgroundQueries} runs. Default {@link query} runs listen until close so
   * feed / prefetch / replaceable fetches yield to search and publish.
   */
  private backgroundInterruptController = new AbortController()

  /**
   * Best-effort: abort in-flight {@link query} calls that did not pass `foreground: true`, then reset the token so
   * new background work uses a fresh signal.
   */
  interruptBackgroundQueries(): void {
    this.backgroundInterruptController.abort()
    this.backgroundInterruptController = new AbortController()
  }

  async acquireGlobalRelayConnectionSlot(): Promise<void> {
    if (this.globalRelayConnectionSlotsInUse < MAX_CONCURRENT_RELAY_CONNECTIONS) {
      this.globalRelayConnectionSlotsInUse++
      return
    }
    await new Promise<void>((resolve) => {
      this.globalRelayConnectionWaitQueue.push(() => {
        this.globalRelayConnectionSlotsInUse++
        resolve()
      })
    })
  }

  releaseGlobalRelayConnectionSlot(): void {
    this.globalRelayConnectionSlotsInUse = Math.max(0, this.globalRelayConnectionSlotsInUse - 1)
    const next = this.globalRelayConnectionWaitQueue.shift()
    if (next) next()
  }

  constructor(pool: SimplePool, relaySession?: QueryServiceRelaySessionOptions) {
    this.pool = pool
    this.onRelayNoticeFetchFailure = relaySession?.onRelayNoticeFetchFailure
  }

  /** Wire after {@link EventService} exists: each `query()` / `fetchEvents` event is ingested from `onevent` (session LRU). */
  setQueryResultIngest(handler: ((events: NEvent[]) => void) | undefined): void {
    this.onQueryResultIngest = handler
  }

  setSigner(signer: ISigner | undefined, signerType: TSignerType | undefined) {
    this.signer = signer
    this.signerType = signerType
  }

  private canSignerAuthenticateRelay(): boolean {
    if (!this.signer) return false
    if (this.signerType === 'npub') return false
    return true
  }

  async acquireSubSlot(relayKey: string): Promise<void> {
    const count = this.activeSubCountByRelay.get(relayKey) ?? 0
    if (count < QueryService.SUB_SLOT_CAP_PER_RELAY) {
      this.activeSubCountByRelay.set(relayKey, count + 1)
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      let queue = this.subSlotWaitQueueByRelay.get(relayKey)
      if (!queue) {
        queue = []
        this.subSlotWaitQueueByRelay.set(relayKey, queue)
      }
      queue.push(() => {
        const n = this.activeSubCountByRelay.get(relayKey) ?? 0
        this.activeSubCountByRelay.set(relayKey, n + 1)
        resolve()
      })
    })
  }

  releaseSubSlot(relayKey: string): void {
    const count = (this.activeSubCountByRelay.get(relayKey) ?? 1) - 1
    this.activeSubCountByRelay.set(relayKey, Math.max(0, count))
    const queue = this.subSlotWaitQueueByRelay.get(relayKey)
    if (queue?.length) {
      const next = queue.shift()!
      next()
    }
  }

  private canonicalSeenOnEventId(eventId: string): string {
    const t = eventId.trim()
    return /^[0-9a-f]{64}$/i.test(t) ? t.toLowerCase() : t
  }

  trackEventSeenOn(eventId: string, relay: AbstractRelay): void {
    this.trackEventSeenOnByUrl(eventId, relay.url)
  }

  trackEventSeenOnByUrl(eventId: string, url: string): void {
    const id = this.canonicalSeenOnEventId(eventId)
    let set = this.eventSeenOnRelays.get(id)
    if (!set) {
      set = new Set()
      this.eventSeenOnRelays.set(id, set)
    }
    set.add(url)
  }

  getSeenEventRelayUrls(eventId: string): string[] {
    return Array.from(this.eventSeenOnRelays.get(this.canonicalSeenOnEventId(eventId)) ?? [])
  }

  /**
   * Core query method with race-based fetching strategies
   */
  async query(
    urls: string[], 
    filter: Filter | Filter[], 
    onevent?: (evt: NEvent) => void,
    options?: QueryOptions
  ): Promise<NEvent[]> {
    const sanitizedFilters = sanitizeFiltersBeforeReq(filter)
    if (sanitizedFilters.length === 0) return []
    if (options?.signal?.aborted) return []

    const maxFilters = RELAY_REQ_MAX_FILTERS_PER_MESSAGE
    if (sanitizedFilters.length > maxFilters) {
      const merged: NEvent[] = []
      const seen = new Set<string>()
      for (let i = 0; i < sanitizedFilters.length; i += maxFilters) {
        const slice = sanitizedFilters.slice(i, i + maxFilters)
        const part = await this.query(urls, slice, onevent, options)
        for (const e of part) {
          if (seen.has(e.id)) continue
          seen.add(e.id)
          merged.push(e)
        }
      }
      return merged
    }

    /** One chunk → pass a single Filter (compat); several (e.g. kinds split) → full array for WS + HTTP. */
    const effectiveFilter: Filter | Filter[] =
      sanitizedFilters.length === 1 ? sanitizedFilters[0]! : sanitizedFilters
    const eoseTimeout = options?.eoseTimeout ?? 500
    const hasNip50Search = filtersHaveNip50Search(sanitizedFilters)
    const globalTimeoutRaw = options?.globalTimeout ?? 10000
    const useNip50QueryTimeoutFloor =
      hasNip50Search && options?.relayOpSource === 'fetchEventsFromSingleRelay'
    const globalTimeout = useNip50QueryTimeoutFloor
      ? Math.max(globalTimeoutRaw, NIP50_QUERY_GLOBAL_TIMEOUT_FLOOR_MS)
      : globalTimeoutRaw
    const replaceableRace = options?.replaceableRace ?? false
    const replaceableRaceWaitMs = options?.replaceableRaceWaitMs ?? FIRST_RELAY_RESULT_GRACE_MS
    const immediateReturn = options?.immediateReturn ?? false

    const filtersForGrace = sanitizedFilters
    const maxLimitForGrace = Math.max(...filtersForGrace.map((f) => (f.limit ?? 0) as number), 0)
    const isSingleEventFetchForGrace = maxLimitForGrace === 1
    const useImplicitFeedFirstRelayGrace =
      maxLimitForGrace >= FEED_FIRST_RELAY_RESULT_GRACE_MIN_LIMIT && !isSingleEventFetchForGrace
    const feedGraceMsResolved: number | null =
      options?.firstRelayResultGraceMs === false
        ? null
        : typeof options?.firstRelayResultGraceMs === 'number'
          ? options.firstRelayResultGraceMs
          : !replaceableRace && !immediateReturn && useImplicitFeedFirstRelayGrace
            ? FIRST_RELAY_RESULT_GRACE_MS
            : null

    const httpRelayBases = Array.from(
      new Set(
        urls
          .filter((u) => isHttpRelayUrl(u))
          .map((u) => normalizeHttpRelayUrl(u) || u)
          .filter(Boolean)
      )
    )
    const wsQueryUrls = urls.filter((u) => !isHttpRelayUrl(u))

    const reqId = ++queryReqSeq
    const source = options?.relayOpSource ?? 'QueryService.query'
    const inputRelaysOrdered = Array.from(new Set(urls.map((u) => normalizeUrl(u) || u).filter(Boolean)))

    const foreground = options?.foreground === true

    return await new Promise<NEvent[]>((resolve) => {
      const events: NEvent[] = []
      const cancelAbortRegistrations: Array<() => void> = []
      const abortHttp = new AbortController()
      let resolveTimeout: ReturnType<typeof setTimeout> | null = null
      let firstResultGraceTimeoutId: ReturnType<typeof setTimeout> | null = null
      let feedFirstResultGraceTimeoutId: ReturnType<typeof setTimeout> | null = null
      let replaceableRaceTimeoutId: ReturnType<typeof setTimeout> | null = null
      let allEosed = false
      let resolved = false
      let firstResultTime: number | null = null
      let globalTimeoutId: ReturnType<typeof setTimeout> | null = null
      let queryFinalizing = false
      let resolvedSnapshot: NEvent[] = []
      let reqEndLogged = false
      let fallbackReqEndTimer: ReturnType<typeof setTimeout> | null = null

      const emitReqEnd = (terminals: RelayOpTerminalRow[], snapshot: NEvent[]) => {
        if (reqEndLogged) return
        reqEndLogged = true
        if (fallbackReqEndTimer != null) {
          clearTimeout(fallbackReqEndTimer)
          fallbackReqEndTimer = null
        }
        logQueryReqConsolidatedEnd(
          reqId,
          source,
          inputRelaysOrdered,
          httpRelayBases,
          snapshot,
          terminals,
          (id) => this.getSeenEventRelayUrls(id)
        )
      }

      const httpInflight =
        httpRelayBases.length === 0
          ? Promise.resolve()
          : Promise.allSettled(
              httpRelayBases.map(async (base) => {
                try {
                  const evts = await queryIndexRelay(base, effectiveFilter, { signal: abortHttp.signal })
                  for (const evt of evts) {
                    if (resolved) return
                    onevent?.(evt)
                    events.push(evt)
                    this.trackEventSeenOnByUrl(evt.id, base)
                    if (!shouldDropEventOnIngest(evt)) {
                      this.onQueryResultIngest?.([evt])
                    }
                    if (firstResultTime === null) {
                      firstResultTime = Date.now()
                    }
                  }
                  relaySessionStrikes.recordReadSuccess(base)
                } catch (e) {
                  if ((e as Error).name === 'AbortError') return
                  relaySessionStrikes.recordReadFailure(base, 'http')
                  if (!isIndexRelayTransportFailure(e)) {
                    logger.warn('[QueryService] HTTP index relay query failed', { base, error: e })
                  }
                }
              })
            ).then(() => {})

      const resolveReplaceableRaceEvents = (): NEvent[] => {
        if (events.length === 0) return events
        const filters = Array.isArray(filter) ? filter : [filter]
        const authorSet = new Set<string>()
        for (const f of filters) {
          if (f.authors) {
            for (const a of f.authors) {
              if (a) authorSet.add(a)
            }
          }
        }
        // Batch profile / replaceable fetch: keep the newest event per pubkey (not one global "winner")
        if (authorSet.size > 1) {
          const byPk = new Map<string, NEvent>()
          for (const e of events) {
            if (!authorSet.has(e.pubkey)) continue
            const prev = byPk.get(e.pubkey)
            if (!prev || e.created_at > prev.created_at) {
              byPk.set(e.pubkey, e)
            }
          }
          return Array.from(byPk.values())
        }
        const bestEvent = events.reduce((best, current) =>
          current.created_at > best.created_at ? current : best
        )
        return [bestEvent]
      }

      const resolveWithEvents = () => {
        if (resolved || queryFinalizing) return
        queryFinalizing = true
        /**
         * Never block resolution on {@link httpInflight}: a hung HTTP index `fetch` can keep
         * `Promise.allSettled` pending forever, so `globalTimeout` would fire but this callback
         * would never run and the query promise would never resolve.
         */
        const finalizeOnce = () => {
          if (resolved) return
          for (const detach of cancelAbortRegistrations) {
            detach()
          }
          cancelAbortRegistrations.length = 0
          resolved = true
          if (resolveTimeout) clearTimeout(resolveTimeout)
          if (firstResultGraceTimeoutId) clearTimeout(firstResultGraceTimeoutId)
          if (feedFirstResultGraceTimeoutId) clearTimeout(feedFirstResultGraceTimeoutId)
          if (replaceableRaceTimeoutId) clearTimeout(replaceableRaceTimeoutId)
          if (globalTimeoutId) clearTimeout(globalTimeoutId)

          const resolvedList =
            replaceableRace && events.length > 0 ? resolveReplaceableRaceEvents() : events
          resolvedSnapshot = resolvedList

          if (wsQueryUrls.length === 0) {
            emitReqEnd([], resolvedList)
          } else {
            fallbackReqEndTimer = setTimeout(() => {
              emitReqEnd([], resolvedList)
            }, Math.min(globalTimeout + 2500, 45_000))
          }

          sub.close()

          resolve(resolvedList)
        }

        const httpCapMs = Math.min(globalTimeout + 5000, 60_000)
        void Promise.race([
          httpInflight.catch(() => undefined),
          new Promise<void>((r) => setTimeout(r, httpCapMs))
        ]).finally(() => {
          finalizeOnce()
        })
      }

      const wsSub = this.subscribe(
        wsQueryUrls,
        effectiveFilter,
        {
        onevent: (evt) => {
          onevent?.(evt)
          events.push(evt)
          // Session cache: ingest as events arrive (reactions/replies/zaps from note-stats, etc.),
          // not only at resolve — otherwise embeds and fetchEvent miss until EOSE.
          if (!shouldDropEventOnIngest(evt)) {
            this.onQueryResultIngest?.([evt])
          }

          if (firstResultTime === null) {
            firstResultTime = Date.now()
          }

          const filters = sanitizedFilters
          const maxLimit = Math.max(...filters.map((f) => (f.limit ?? 0) as number), 0)
          const isSingleEventFetch = maxLimit === 1
          const hasIdFilter = filters.some((f) => f.ids && f.ids.length > 0)
          const hasReplaceableCoordFilter = someFilterHasReplaceableCoordinate(filters)

          // For immediateReturn: return as soon as we find the event
          // This is critical for non-replaceable events (not in 10000-19999 or 30000-39999 ranges)
          // which should be rendered ASAP
          if (
            immediateReturn &&
            (hasIdFilter || hasReplaceableCoordFilter) &&
            isSingleEventFetch &&
            events.length > 0
          ) {
            resolveWithEvents()
            return
          }

          if (replaceableRace && firstResultTime !== null && !replaceableRaceTimeoutId) {
            replaceableRaceTimeoutId = setTimeout(() => {
              replaceableRaceTimeoutId = null
              resolveWithEvents()
            }, replaceableRaceWaitMs)
          }

          if (
            feedGraceMsResolved != null &&
            events.length >= 1 &&
            !feedFirstResultGraceTimeoutId &&
            !replaceableRace
          ) {
            feedFirstResultGraceTimeoutId = setTimeout(() => {
              feedFirstResultGraceTimeoutId = null
              resolveWithEvents()
            }, feedGraceMsResolved)
          }

          if (!replaceableRace && !immediateReturn && isSingleEventFetch && events.length === 1 && !firstResultGraceTimeoutId) {
            firstResultGraceTimeoutId = setTimeout(() => {
              firstResultGraceTimeoutId = null
              resolveWithEvents()
            }, FIRST_RELAY_RESULT_GRACE_MS)
          }

          if (hasIdFilter && isSingleEventFetch && events.length > 0 && allEosed && !replaceableRace && !immediateReturn) {
            if (firstResultGraceTimeoutId) clearTimeout(firstResultGraceTimeoutId)
            if (resolveTimeout) clearTimeout(resolveTimeout)
            resolveTimeout = setTimeout(() => resolveWithEvents(), 100)
          }
        },
        oneose: (eosed) => {
          if (eosed) {
            allEosed = true
            
            if (replaceableRace) {
              if (events.length > 0 && replaceableRaceTimeoutId) return
              if (events.length > 0) {
                resolveWithEvents()
                return
              }
            }
            
            if (immediateReturn && events.length > 0) {
              resolveWithEvents()
              return
            }
            
            if (firstResultGraceTimeoutId) clearTimeout(firstResultGraceTimeoutId)
            if (feedFirstResultGraceTimeoutId) clearTimeout(feedFirstResultGraceTimeoutId)
            if (resolveTimeout) clearTimeout(resolveTimeout)
            resolveTimeout = setTimeout(() => resolveWithEvents(), eoseTimeout)
          }
        },
        onclose: (_url, _reason) => {
          if (allEosed) return
          if (events.length > 0 && !resolveTimeout) {
            resolveTimeout = setTimeout(() => resolveWithEvents(), 1000)
          }
        }
      },
        { source: options?.relayOpSource ?? 'QueryService.query', logLevel: 'debug', quiet: true, onBatchEnd: (rows) => emitReqEnd(rows, resolvedSnapshot) }
      )

      const sub = {
        close: () => {
          abortHttp.abort()
          wsSub.close()
        }
      }

      const onAbortQuery = () => {
        sub.close()
        resolveWithEvents()
      }
      const registerQueryAbort = (sig: AbortSignal) => {
        if (sig.aborted) {
          queueMicrotask(() => {
            onAbortQuery()
          })
          return
        }
        sig.addEventListener('abort', onAbortQuery, { once: true })
        cancelAbortRegistrations.push(() => {
          sig.removeEventListener('abort', onAbortQuery)
        })
      }
      if (!foreground) {
        registerQueryAbort(this.backgroundInterruptController.signal)
      }
      if (options?.signal) {
        registerQueryAbort(options.signal)
      }

      globalTimeoutId = setTimeout(() => resolveWithEvents(), globalTimeout)
    })
  }

  /**
   * Subscribe to events from relays
   */
  subscribe(
    urls: string[],
    filter: Filter | Filter[],
    callbacks: SubscribeCallbacks,
    relayOpMeta?: {
      source: string
      logLevel?: 'info' | 'debug'
      /** When true, suppress `[RelayOp] batch_begin` / `batch_end` (used by {@link QueryService.query}). */
      quiet?: boolean
      onBatchEnd?: (rows: RelayOpTerminalRow[]) => void
    }
  ): { close: () => void } {
    const filters = sanitizeFiltersBeforeReq(filter)
    if (filters.length === 0) {
      queueMicrotask(() => callbacks.oneose?.(true))
      return { close: () => {} }
    }
    const originalDedupedRelays = Array.from(new Set(urls))
    let relays = originalDedupedRelays

    const stripSocialBlockedRelays =
      SOCIAL_KIND_BLOCKED_RELAY_URLS.length > 0 &&
      filters.some((f) => relayFilterIncludesSocialKindBlockedKind(f))
    if (stripSocialBlockedRelays) {
      const socialKindBlockedSet = new Set(SOCIAL_KIND_BLOCKED_RELAY_URLS.map((u) => normalizeUrl(u) || u))
      const stripped = relays.filter((url) => !socialKindBlockedSet.has(normalizeUrl(url) || url))
      relays = relaysAfterSocialKindBlockedStrip(originalDedupedRelays, stripped)
    }
    if (relayFiltersUseCapitalLetterTagKeys(filters)) {
      relays = relayUrlsStripExtendedTagReqBlocked(relays)
      if (relays.length === 0) {
        relays = relayUrlsStripExtendedTagReqBlocked([...FAST_READ_RELAY_URLS])
      }
    }
    relays = relays.filter((url) => !isHttpRelayUrl(url))

    const wsCountBeforeStrikes = relays.length
    if (wsCountBeforeStrikes > 1) {
      relays = relaySessionStrikes.filterReadHttpUrls(relays)
    }

    if (relays.length === 0) {
      queueMicrotask(() => callbacks.oneose?.(true))
      return { close: () => {} }
    }

    const _knownIds = new Set<string>()
    const grouped = new Map<string, Filter[]>()
    for (const url of relays) {
      const key = normalizeUrl(url) || url
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(...filters)
    }
    
    const searchableSet = new Set([
      ...SEARCHABLE_RELAY_URLS.map((u) => normalizeUrl(u) || u),
      ...nip66Service.getSearchableRelayUrls().map((u) => normalizeUrl(u) || u),
      ...PROFILE_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter(Boolean)
    ])
    
    const groupedRequests = Array.from(grouped.entries()).map(([url, f]) => {
      const relaySupportsSearch = searchableSet.has(url) || nip66Service.isRelaySearchable(url)
      const filtersForRelay = f.map((one) => filterForRelay(one, relaySupportsSearch))
      return { url, filters: filtersForRelay }
    })

    const hasNip50Search = filtersHaveNip50Search(filters)
    const relaySubscriptionEoseTimeoutMs = hasNip50Search
      ? NIP50_RELAY_SUBSCRIPTION_EOSE_TIMEOUT_MS
      : 10_000
    /**
     * Single-relay `pool.close` before subscribe resets the socket. Overlapping NIP-50 one-shots (e.g. Strict Mode
     * double effect) then tear down each other’s REQ before EOSE → empty results until globalTimeout.
     */
    if (groupedRequests.length === 1 && !hasNip50Search) {
      try {
        this.pool.close([groupedRequests[0]!.url])
      } catch {
        /* ignore */
      }
    }

    const opSource = relayOpMeta?.source ?? 'QueryService.subscribe'
    const opBatch =
      groupedRequests.length > 0
        ? new RelaySubscribeOpBatch(opSource, groupedRequests, {
            logLevel: relayOpMeta?.logLevel,
            quiet: relayOpMeta?.quiet,
            onBatchEnd: relayOpMeta?.onBatchEnd
          })
        : null
    opBatch?.logBegin()

    const eosesReceived: boolean[] = []
    const closesReceived: (string | undefined)[] = []
    const handleEose = (i: number) => {
      if (eosesReceived[i]) return
      eosesReceived[i] = true
      opBatch?.setTerminal(i, 'eose')
      relaySessionStrikes.recordReadSuccess(groupedRequests[i]!.url)
      if (eosesReceived.filter(Boolean).length === groupedRequests.length) {
        callbacks.oneose?.(true)
      }
    }
    const handleClose = (i: number, reason: string) => {
      if (closesReceived[i] !== undefined) return
      handleEose(i)
      closesReceived[i] = reason
      opBatch?.setTerminal(i, 'closed', reason)
      const { url } = groupedRequests[i]!
      callbacks.onclose?.(url, reason)
      if (closesReceived.every((r) => r !== undefined)) {
        callbacks.onAllClose?.(closesReceived as string[])
      }
    }

    const localAlreadyHaveEvent = (id: string) => {
      const have = _knownIds.has(id)
      if (have) return true
      _knownIds.add(id)
      return false
    }

    const forwardOnevent = callbacks.onevent
      ? (evt: NEvent) => {
          if (shouldDropEventOnIngest(evt)) return
          callbacks.onevent!(evt)
        }
      : undefined

    const subs: { relayKey: string; close: () => void }[] = []
    const nip42ResubscribePending = new Set<number>()
    /** Same idea as `master` subscribe: only one successful auth+resubscribe cycle per relay slot. */
    const nip42HasAuthedOnce = new Set<number>()
    const allOpened = Promise.all(
      groupedRequests.map(async ({ url, filters: relayFilters }, i) => {
        await this.acquireGlobalRelayConnectionSlot()
        try {
          const relayKey = normalizeUrl(url) || url
          await this.acquireSubSlot(relayKey)
          let relay: AbstractRelay
          try {
            relay = await this.pool.ensureRelay(url, {
              connectionTimeout: RELAY_POOL_CONNECTION_TIMEOUT_MS
            })
            patchRelayNoticeForFetchFailures(relay, relayKey, this.onRelayNoticeFetchFailure)
          } catch (err) {
            relaySessionStrikes.recordReadFailure(url, 'connection')
            this.releaseSubSlot(relayKey)
            handleClose(i, (err as Error)?.message ?? String(err))
            return
          }

          let slotReleased = false
          const releaseOnce = () => {
            if (!slotReleased) {
              slotReleased = true
              this.releaseSubSlot(relayKey)
            }
          }

          const sub = relay.subscribe(relayFilters, {
            receivedEvent: (_relay, id) => this.trackEventSeenOn(id, _relay),
            onevent: (evt: NEvent) => forwardOnevent?.(evt),
            oneose: () => handleEose(i),
            onclose: (reason: string) => {
              if (isRelaySubscriptionClosedByCaller(reason) && nip42ResubscribePending.has(i)) {
                return
              }
              releaseOnce()
              if (
                isRelayAuthRequiredCloseReason(reason) &&
                this.canSignerAuthenticateRelay() &&
                !nip42HasAuthedOnce.has(i)
              ) {
                nip42ResubscribePending.add(i)
                applyRelayNip42AckTimeout(relay)
                authenticateNip42Relay(relay, async (authEvt: EventTemplate) => {
                  const evt = await queueRelayAuthSign(() => this.signer!.signEvent(authEvt))
                  if (!evt) throw new Error('sign event failed')
                  return evt as VerifiedEvent
                })
                  .then(async () => {
                    nip42HasAuthedOnce.add(i)
                    await this.acquireGlobalRelayConnectionSlot()
                    try {
                      await this.acquireSubSlot(relayKey)
                      let liveRelay: AbstractRelay
                      try {
                        liveRelay = await this.pool.ensureRelay(url, {
                          connectionTimeout: RELAY_POOL_CONNECTION_TIMEOUT_MS
                        })
                        patchRelayNoticeForFetchFailures(liveRelay, relayKey, this.onRelayNoticeFetchFailure)
                      } catch (err) {
                        relaySessionStrikes.recordReadFailure(url, 'connection')
                        nip42ResubscribePending.delete(i)
                        this.releaseSubSlot(relayKey)
                        handleClose(i, (err as Error)?.message ?? String(err))
                        return
                      }
                      let slotReleased2 = false
                      const releaseSlot2 = () => {
                        if (!slotReleased2) {
                          slotReleased2 = true
                          this.releaseSubSlot(relayKey)
                        }
                      }
                      try {
                        const sub2 = liveRelay.subscribe(relayFilters, {
                          receivedEvent: (_relay, id) => this.trackEventSeenOn(id, _relay),
                          onevent: (evt: NEvent) => forwardOnevent?.(evt),
                          oneose: () => handleEose(i),
                          onclose: (reason2: string) => {
                            releaseSlot2()
                            handleClose(i, reason2)
                          },
                          alreadyHaveEvent: localAlreadyHaveEvent,
                          eoseTimeout: relaySubscriptionEoseTimeoutMs
                        })
                        subs.push({
                          relayKey,
                          close: () => {
                            releaseSlot2()
                            sub2.close()
                          }
                        })
                        nip42ResubscribePending.delete(i)
                      } catch (err) {
                        relaySessionStrikes.recordReadFailure(url, 'connection')
                        nip42ResubscribePending.delete(i)
                        releaseSlot2()
                        handleClose(i, (err as Error)?.message ?? String(err))
                      }
                    } finally {
                      this.releaseGlobalRelayConnectionSlot()
                    }
                  })
                  .catch(() => {
                    nip42ResubscribePending.delete(i)
                    handleClose(i, reason)
                  })
                return
              }
              if (isRelayAuthRequiredCloseReason(reason)) {
                callbacks.startLogin?.()
              }
              handleClose(i, reason)
            },
            alreadyHaveEvent: localAlreadyHaveEvent,
            eoseTimeout: relaySubscriptionEoseTimeoutMs
          })
          subs.push({
            relayKey,
            close: () => {
              releaseOnce()
              sub.close()
            }
          })
        } finally {
          this.releaseGlobalRelayConnectionSlot()
        }
      })
    )

    return {
      close: () => {
        // Close subs first, then finalize — otherwise finalize runs before any EOSE/onclose and every
        // relay is mis-labeled "skipped" in batch_end.
        void allOpened.then(() => {
          subs.forEach(({ close: subClose }) => subClose())
          setTimeout(() => opBatch?.finalize('closed', 'subscribe_close'), 0)
        })
      }
    }
  }

  /**
   * Fetch events with caching support
   */
  async fetchEvents(
    urls: string[],
    filter: Filter | Filter[],
    options?: {
      onevent?: (evt: NEvent) => void
    } & QueryOptions
  ): Promise<NEvent[]> {
    const originalDedupedRelays = Array.from(new Set(urls))
    let relays = originalDedupedRelays
    if (relays.length === 0) {
      relays = [...FAST_READ_RELAY_URLS]
    }
    const filters = Array.isArray(filter) ? filter : [filter]
    const stripSocialBlockedRelays =
      SOCIAL_KIND_BLOCKED_RELAY_URLS.length > 0 &&
      filters.some((f) => relayFilterIncludesSocialKindBlockedKind(f))
    if (stripSocialBlockedRelays) {
      const socialKindBlockedSet = new Set(SOCIAL_KIND_BLOCKED_RELAY_URLS.map((u) => normalizeUrl(u) || u))
      const stripped = relays.filter((url) => !socialKindBlockedSet.has(normalizeUrl(url) || url))
      relays = relaysAfterSocialKindBlockedStrip(originalDedupedRelays, stripped)
      if (relays.length === 0) {
        const fallback = [...FAST_READ_RELAY_URLS].filter(
          (url) => !socialKindBlockedSet.has(normalizeUrl(url) || url)
        )
        relays = fallback.length > 0 ? fallback : [...FAST_READ_RELAY_URLS]
      }
    }
    if (relayFiltersUseCapitalLetterTagKeys(filters)) {
      relays = relayUrlsStripExtendedTagReqBlocked(relays)
      if (relays.length === 0) {
        relays = relayUrlsStripExtendedTagReqBlocked([...FAST_READ_RELAY_URLS])
      }
    }
    const { onevent, ...queryOpts } = options ?? {}
    return this.query(relays, filter, onevent, queryOpts)
  }
}
