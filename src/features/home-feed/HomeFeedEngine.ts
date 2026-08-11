import {
  applyPersistedFeedSinceToSubRequests,
  clearPersistedFeedSince,
  persistFeedSince
} from '@/lib/feed-since-persist'
import { compareEventsNewestFirst } from '@/lib/event-created-at'
import { stripNostrLandAggrFromTimelineSubRequests } from '@/lib/home-feed-relays'
import { relayOpTerminalRowsToTimelineRelayUiStatuses } from '@/services/relay-operation-log.service'
import type { RelayOpTerminalRow } from '@/services/relay-operation-log.service'
import type { TFeedSubRequest, TSubRequestFilter } from '@/types'
import { FAST_READ_RELAY_URLS } from '@/constants'
import type { Event, Filter } from 'nostr-tools'
import { kinds } from 'nostr-tools'
import type { HomeFeedDescriptorBundle } from './buildHomeFeedDescriptor'
import {
  HOME_FEED_EMPTY_PAGE_THRESHOLD,
  HOME_FEED_EVENT_CAP,
  HOME_FEED_LIVE_ON_NEW_FLUSH_MS,
  HOME_FEED_LOADING_SAFETY_MS,
  HOME_FEED_LOCAL_PRIME_MAX_ROWS_SCANNED,
  HOME_FEED_MAX_LOAD_MORE_PAGES,
  HOME_FEED_PAGE_LIMIT,
  HOME_FEED_SKIP_ARCHIVE_PRIME_MIN_ROWS,
  STALE_HOME_FEED_MAX_AGE_SEC,
  STALE_HOME_FEED_REFRESH_COOLDOWN_MS
} from './constants'
import { mergeEventsById } from './merge-events'
import {
  getSessionFeedSnapshot,
  getSessionFeedSnapshotWithFeedFallback,
  setSessionFeedSnapshot
} from '@/services/session-feed-snapshot.service'
import logger from '@/lib/logger'
import activityTrace from '@/lib/activity-trace'
import indexedDb from '@/services/indexed-db.service'

function unionKindsFromSubRequests(requests: readonly TFeedSubRequest[]): number[] {
  const kindSet = new Set<number>()
  for (const req of requests) {
    const list = req.filter.kinds
    if (list?.length) {
      for (const k of list) kindSet.add(k)
    }
  }
  if (kindSet.size === 0) kindSet.add(kinds.ShortTextNote)
  return [...kindSet]
}

function asTimelineSubRequests(requests: readonly TFeedSubRequest[]) {
  return requests as Array<{ urls: string[]; filter: TSubRequestFilter }>
}

export type HomeFeedEngineSnapshot = {
  rawEvents: Event[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  timelineKey?: string
  relayOutcomes: RelayOpTerminalRow[]
  error?: string
  generation: number
  /** True after first events, wave-complete, or loading safety timeout. */
  emptyUiReady: boolean
}

export type HomeFeedEngineClient = {
  subscribeTimeline: (
    subRequests: { urls: string[]; filter: TSubRequestFilter }[],
    callbacks: {
      onEvents: (events: Event[], eosed: boolean) => void
      onNew: (evt: Event) => void
    },
    options?: {
      onRelaySubscribeWaveComplete?: (rows: RelayOpTerminalRow[]) => void
      relayAuthoritativeTimeline?: boolean
      feedScopeKey?: string
      mergeFeedWave?: boolean
      connectionSlotPriority?: boolean
    }
  ) => Promise<{ closer: () => void; timelineKey: string }>
  fetchEvents: (
    urls: string[],
    filter: Filter | Filter[],
    options?: { cache?: boolean; globalTimeout?: number; eoseTimeout?: number }
  ) => Promise<Event[]>
  getTimelineDiskSnapshotEvents?: (
    subRequests: { urls: string[]; filter: TSubRequestFilter }[]
  ) => Promise<Event[]>
  getLocalFeedEvents?: (
    subRequests: { urls: string[]; filter: TSubRequestFilter }[],
    options?: { maxRowsScanned?: number; maxMatches?: number }
  ) => Promise<Event[]>
  loadMoreTimeline: (
    timelineKey: string,
    until: number,
    limit: number,
    excludeIds?: Set<string>
  ) => Promise<Event[]>
  getLocalFeedEventsOlderThan?: (
    subRequests: { urls: string[]; filter: TSubRequestFilter }[],
    until: number,
    limit: number,
    excludeIds?: Set<string>
  ) => Promise<Event[]>
  hasMoreTimelineEventsIncludingPersisted?: (timelineKey: string, until: number) => Promise<boolean>
}

export type HomeFeedEngineOptions = {
  client: HomeFeedEngineClient
  bundle: HomeFeedDescriptorBundle
  sessionSnapshotKey: string
  onChange: (snapshot: HomeFeedEngineSnapshot) => void
  /** Return 'pending' to queue live events instead of merging immediately. */
  onLiveEvent?: (event: Event) => 'merge' | 'pending'
  onPendingEvents?: (events: readonly Event[]) => void
}

export class HomeFeedEngine {
  private generation = 0
  private closer: (() => void) | null = null
  private rawEvents: Event[] = []
  private loading = false
  private loadingMore = false
  private hasMore = true
  private timelineKey?: string
  private relayOutcomes: RelayOpTerminalRow[] = []
  private error?: string
  private emptyUiReady = false
  private publicFallbackAttempted = false
  private staleRefreshAt = 0
  private staleCheckDone = false
  private emptyLoadMoreStreak = 0
  private skipPersistedSince = false
  private previousSubscriptionKey?: string
  private previousActiveUrlsKey?: string
  private pendingLive: Event[] = []
  private liveMergeBuffer: Event[] = []
  private liveFlushTimer: ReturnType<typeof setTimeout> | null = null
  private loadingSafetyTimer: ReturnType<typeof setTimeout> | null = null
  private startPaintAt = 0
  private firstEventTraced = false
  private liveEmitCount = 0

  constructor(private options: HomeFeedEngineOptions) {}

  getSnapshot(): HomeFeedEngineSnapshot {
    return {
      rawEvents: this.rawEvents,
      loading: this.loading,
      loadingMore: this.loadingMore,
      hasMore: this.hasMore,
      timelineKey: this.timelineKey,
      relayOutcomes: this.relayOutcomes,
      error: this.error,
      generation: this.generation,
      emptyUiReady: this.emptyUiReady
    }
  }

  private emit() {
    this.options.onChange(this.getSnapshot())
  }

  /** Soft-update descriptor without destroying the engine (personal-relay revision, etc.). */
  updateBundle(bundle: HomeFeedDescriptorBundle, sessionSnapshotKey?: string) {
    this.options = {
      ...this.options,
      bundle,
      ...(sessionSnapshotKey != null ? { sessionSnapshotKey } : {})
    }
  }

  private mappedSubRequests(): TFeedSubRequest[] {
    const { bundle } = this.options
    return applyPersistedFeedSinceToSubRequests(bundle.activeSubRequests, {
      scopeKey: bundle.sinceScopeKey,
      skip: this.skipPersistedSince
    })
  }

  private persistSession() {
    const { sessionSnapshotKey } = this.options
    if (sessionSnapshotKey && this.rawEvents.length > 0) {
      setSessionFeedSnapshot(sessionSnapshotKey, this.rawEvents)
    }
    persistFeedSince(this.options.bundle.sinceScopeKey, this.rawEvents)
  }

  private shouldPreserveRows(bundle: HomeFeedDescriptorBundle): boolean {
    if (!bundle.descriptor.source.preserveRowsOnRelayChange) return false
    if (this.previousSubscriptionKey !== bundle.subscriptionKey) return false
    const urlsKey = bundle.activeSubRequests
      .flatMap((r) => r.urls)
      .map((u) => u.toLowerCase())
      .sort()
      .join('|')
    if (!this.previousActiveUrlsKey) return false
    return urlsKey.startsWith(this.previousActiveUrlsKey) || urlsKey.includes(this.previousActiveUrlsKey)
  }

  private clearLiveFlushTimer() {
    if (this.liveFlushTimer != null) {
      clearTimeout(this.liveFlushTimer)
      this.liveFlushTimer = null
    }
  }

  private clearLoadingSafetyTimer() {
    if (this.loadingSafetyTimer != null) {
      clearTimeout(this.loadingSafetyTimer)
      this.loadingSafetyTimer = null
    }
  }

  private markFirstEventIfNeeded() {
    if (this.firstEventTraced || this.rawEvents.length === 0) return
    this.firstEventTraced = true
    activityTrace.trace('relay', 'homeFeed.timeToFirstEvent', {
      ms: Math.round(performance.now() - this.startPaintAt),
      rows: this.rawEvents.length
    })
  }

  private finishInitialLoading() {
    this.clearLoadingSafetyTimer()
    this.loading = false
    this.emptyUiReady = true
  }

  private flushLiveMerges() {
    this.clearLiveFlushTimer()
    if (this.liveMergeBuffer.length === 0) return
    const batch = this.liveMergeBuffer
    this.liveMergeBuffer = []
    this.liveEmitCount += 1
    this.rawEvents = mergeEventsById(batch, this.rawEvents, HOME_FEED_EVENT_CAP)
    activityTrace.trace('state', 'homeFeed.liveEmit', {
      batchSize: batch.length,
      emitN: this.liveEmitCount,
      cap: HOME_FEED_EVENT_CAP
    })
    this.markFirstEventIfNeeded()
    this.emit()
  }

  private scheduleLiveFlush() {
    if (this.liveFlushTimer != null) return
    this.liveFlushTimer = setTimeout(() => {
      this.liveFlushTimer = null
      this.flushLiveMerges()
    }, HOME_FEED_LIVE_ON_NEW_FLUSH_MS)
  }

  private armLoadingSafety(gen: number) {
    this.clearLoadingSafetyTimer()
    this.loadingSafetyTimer = setTimeout(() => {
      this.loadingSafetyTimer = null
      if (gen !== this.generation) return
      if (!this.loading && this.emptyUiReady) return
      activityTrace.trace('relay', 'homeFeed.loadingSafety', {
        ms: HOME_FEED_LOADING_SAFETY_MS,
        rows: this.rawEvents.length
      })
      this.finishInitialLoading()
      this.emit()
    }, HOME_FEED_LOADING_SAFETY_MS)
  }

  async start(refresh = false): Promise<void> {
    this.closeSubscription()
    this.clearLiveFlushTimer()
    this.liveMergeBuffer = []
    const gen = ++this.generation
    const { bundle, client, sessionSnapshotKey } = this.options
    this.startPaintAt = performance.now()
    this.firstEventTraced = false
    this.liveEmitCount = 0
    activityTrace.trace('relay', 'homeFeed.start', {
      refresh,
      subscriptionKey: bundle.subscriptionKey
    })

    if (refresh) {
      clearPersistedFeedSince(bundle.sinceScopeKey)
      this.skipPersistedSince = true
      this.publicFallbackAttempted = false
      this.staleCheckDone = false
    } else {
      this.skipPersistedSince = false
    }

    const preserve = !refresh && this.shouldPreserveRows(bundle)
    if (!preserve && !refresh) {
      const session =
        getSessionFeedSnapshot(sessionSnapshotKey) ??
        getSessionFeedSnapshotWithFeedFallback(
          sessionSnapshotKey,
          bundle.subscriptionKey
        )
      if (session?.length) {
        this.rawEvents = mergeEventsById([], session, HOME_FEED_EVENT_CAP)
        this.loading = true
        this.emptyUiReady = false
        this.markFirstEventIfNeeded()
        this.emit()
      } else {
        this.rawEvents = preserve ? this.rawEvents : []
      }
    } else if (refresh) {
      this.rawEvents = []
    }

    this.loading = true
    this.emptyUiReady = this.rawEvents.length > 0
    this.hasMore = true
    this.error = undefined
    this.relayOutcomes = []
    this.emit()
    this.armLoadingSafety(gen)

    this.previousSubscriptionKey = bundle.subscriptionKey
    this.previousActiveUrlsKey = bundle.activeSubRequests
      .flatMap((r) => r.urls)
      .map((u) => u.toLowerCase())
      .sort()
      .join('|')

    const mapped = stripNostrLandAggrFromTimelineSubRequests(
      bundle.subscriptionKey,
      this.mappedSubRequests()
    ).filter((r) => r.urls.length > 0)

    if (mapped.length === 0) {
      this.finishInitialLoading()
      this.hasMore = false
      this.emit()
      return
    }

    if (!bundle.relaySetFeedOnly) {
      await this.primeFromLocalStores(gen, mapped)
      if (gen !== this.generation) return
    }

    try {
      const result = await client.subscribeTimeline(
        asTimelineSubRequests(mapped),
        {
          onEvents: (events, _eosed) => {
            if (gen !== this.generation) return
            if (events.length === 0) return
            this.rawEvents = mergeEventsById(this.rawEvents, events, HOME_FEED_EVENT_CAP)
            this.finishInitialLoading()
            this.markFirstEventIfNeeded()
            this.emit()
          },
          onNew: (evt) => {
            if (gen !== this.generation) return
            const route = this.options.onLiveEvent?.(evt) ?? 'merge'
            if (route === 'pending') {
              if (!this.pendingLive.some((e) => e.id === evt.id)) {
                this.pendingLive.push(evt)
                this.options.onPendingEvents?.(this.pendingLive)
              }
              return
            }
            this.liveMergeBuffer.push(evt)
            this.scheduleLiveFlush()
          }
        },
        {
          relayAuthoritativeTimeline: bundle.relaySetFeedOnly,
          feedScopeKey: bundle.subscriptionKey,
          connectionSlotPriority: true,
          onRelaySubscribeWaveComplete: (rows) => {
            if (gen !== this.generation) return
            this.relayOutcomes = rows
            this.finishInitialLoading()
            this.persistSession()
            void this.maybePublicReadFallback(gen, mapped)
            this.maybeStaleAutoRefresh(gen)
            this.emit()
          }
        }
      )

      if (gen !== this.generation) {
        result.closer()
        return
      }

      this.closer = result.closer
      this.timelineKey = result.timelineKey
      // subscribeTimeline resolves when shards are wired — keep loading until first events,
      // wave-complete, or safety timeout so empty UI does not flash "No posts found".
      if (this.rawEvents.length > 0) {
        this.finishInitialLoading()
      }
      this.emit()
    } catch (e) {
      if (gen !== this.generation) return
      this.error = e instanceof Error ? e.message : String(e)
      this.finishInitialLoading()
      this.emit()
    }
  }

  private async primeFromLocalStores(
    gen: number,
    mapped: readonly TFeedSubRequest[]
  ): Promise<void> {
    const { client } = this.options
    const reqs = asTimelineSubRequests(mapped)
    const localCap = Math.min(HOME_FEED_EVENT_CAP, Math.max(HOME_FEED_PAGE_LIMIT * 2, 200))
    const maxRowsScanned = HOME_FEED_LOCAL_PRIME_MAX_ROWS_SCANNED
    const sessionAlreadyWarm = this.rawEvents.length >= HOME_FEED_SKIP_ARCHIVE_PRIME_MIN_ROWS

    try {
      const localPromise = client.getLocalFeedEvents
        ? client.getLocalFeedEvents(reqs, {
            maxRowsScanned,
            maxMatches: Math.min(localCap * 3, 3000)
          })
        : client.getTimelineDiskSnapshotEvents
          ? client.getTimelineDiskSnapshotEvents(reqs)
          : Promise.resolve([] as Event[])

      const archivePromise = sessionAlreadyWarm
        ? Promise.resolve([] as Event[])
        : indexedDb
            .scanEventArchiveByKinds({
              kinds: unionKindsFromSubRequests(mapped),
              maxRowsScanned,
              maxMatches: localCap * 2
            })
            .catch(() => [] as Event[])

      const [localRows, archiveRows] = await Promise.all([localPromise, archivePromise])
      if (gen !== this.generation) return

      activityTrace.trace('cache', 'homeFeed.prime', {
        local: localRows.length,
        archive: archiveRows.length,
        skippedArchive: sessionAlreadyWarm,
        maxRowsScanned
      })

      const merged = mergeEventsById(
        mergeEventsById(this.rawEvents, localRows, HOME_FEED_EVENT_CAP),
        archiveRows,
        HOME_FEED_EVENT_CAP
      )
      if (merged.length !== this.rawEvents.length) {
        this.rawEvents = merged
        this.markFirstEventIfNeeded()
        this.emit()
      }
    } catch {
      /* local warmup is best-effort */
    }
  }

  private async maybePublicReadFallback(
    gen: number,
    mapped: TFeedSubRequest[]
  ): Promise<void> {
    const { bundle, client } = this.options
    if (!bundle.descriptor.source.publicReadFallback) return
    if (bundle.relaySetFeedOnly) return
    if (this.publicFallbackAttempted) return
    if (!navigator.onLine) return

    const uiStatuses = relayOpTerminalRowsToTimelineRelayUiStatuses(this.relayOutcomes)
    if (uiStatuses.some((s) => s.success) && this.rawEvents.length > 0) return

    this.publicFallbackAttempted = true
    const filter: Filter = { ...(mapped[0]!.filter as Filter) }
    if (!filter.kinds?.length) {
      filter.kinds = [kinds.ShortTextNote]
    }
    filter.limit = filter.limit ?? HOME_FEED_PAGE_LIMIT

    try {
      const raw = await client.fetchEvents(FAST_READ_RELAY_URLS, filter, {
        cache: true,
        globalTimeout: 22_000,
        eoseTimeout: 3500
      })
      if (gen !== this.generation || raw.length === 0) return
      this.rawEvents = mergeEventsById(this.rawEvents, raw, HOME_FEED_EVENT_CAP)
      logger.info('[HomeFeed] Public read fallback merged', { count: raw.length })
      this.markFirstEventIfNeeded()
      this.emit()
    } catch (e) {
      logger.warn('[HomeFeed] Public read fallback failed', { error: e })
    }
  }

  private maybeStaleAutoRefresh(_gen: number): void {
    if (this.staleCheckDone) return
    this.staleCheckDone = true
    if (this.rawEvents.length === 0) return

    const newest = this.rawEvents.reduce((max, ev) => Math.max(max, ev.created_at), 0)
    const ageSec = Math.floor(Date.now() / 1000) - newest
    if (ageSec <= STALE_HOME_FEED_MAX_AGE_SEC) return

    const now = Date.now()
    if (now - this.staleRefreshAt < STALE_HOME_FEED_REFRESH_COOLDOWN_MS) return
    this.staleRefreshAt = now
    logger.info('[HomeFeed] Stale feed — auto-refresh', { ageSec })
    void this.start(true)
  }

  async loadMore(): Promise<void> {
    if (this.loadingMore || this.loading || !this.timelineKey) return
    const gen = this.generation
    this.loadingMore = true
    this.emit()

    const { client } = this.options
    const sorted = [...this.rawEvents].sort(compareEventsNewestFirst)
    const until =
      sorted.length > 0
        ? sorted[sorted.length - 1]!.created_at - 1
        : Math.floor(Date.now() / 1000)
    const excludeIds = new Set(this.rawEvents.map((e) => e.id))

    let fetched: Event[] = []
    try {
      if (client.getLocalFeedEventsOlderThan) {
        fetched = await client.getLocalFeedEventsOlderThan(
          asTimelineSubRequests(this.options.bundle.activeSubRequests),
          until,
          HOME_FEED_PAGE_LIMIT,
          excludeIds
        )
      }
      if (gen !== this.generation) return

      if (fetched.length === 0) {
        fetched = await client.loadMoreTimeline(
          this.timelineKey,
          until,
          HOME_FEED_PAGE_LIMIT,
          excludeIds
        )
      }
      if (gen !== this.generation) return

      if (fetched.length === 0) {
        this.emptyLoadMoreStreak += 1
        if (this.emptyLoadMoreStreak >= HOME_FEED_EMPTY_PAGE_THRESHOLD) {
          this.hasMore = false
        } else if (client.hasMoreTimelineEventsIncludingPersisted) {
          const more = await client.hasMoreTimelineEventsIncludingPersisted(
            this.timelineKey,
            until
          )
          if (!more) this.hasMore = false
        }
      } else {
        this.emptyLoadMoreStreak = 0
        this.rawEvents = mergeEventsById(this.rawEvents, fetched, HOME_FEED_EVENT_CAP)
      }
    } catch (e) {
      if (gen === this.generation) {
        this.error = e instanceof Error ? e.message : String(e)
      }
    } finally {
      if (gen === this.generation) {
        this.loadingMore = false
        this.emit()
      }
    }
  }

  closeSubscription() {
    this.closer?.()
    this.closer = null
  }

  destroy() {
    this.closeSubscription()
    this.clearLiveFlushTimer()
    this.clearLoadingSafetyTimer()
    this.liveMergeBuffer = []
    this.persistSession()
    this.generation++
  }

  refresh(): void {
    void this.start(true)
  }

  flushPendingLive(): void {
    this.flushLiveMerges()
    if (this.pendingLive.length === 0) return
    this.rawEvents = mergeEventsById(this.pendingLive, this.rawEvents, HOME_FEED_EVENT_CAP)
    this.pendingLive = []
    this.options.onPendingEvents?.([])
    this.emit()
  }
}

export async function loadMoreHomeFeedPages(
  engine: HomeFeedEngine,
  maxPages = HOME_FEED_MAX_LOAD_MORE_PAGES
): Promise<void> {
  for (let i = 0; i < maxPages; i++) {
    const before = engine.getSnapshot().rawEvents.length
    await engine.loadMore()
    const after = engine.getSnapshot().rawEvents.length
    if (!engine.getSnapshot().hasMore) break
    if (after <= before) break
  }
}
