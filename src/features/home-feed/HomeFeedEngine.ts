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
  HOME_FEED_MAX_LOAD_MORE_PAGES,
  HOME_FEED_PAGE_LIMIT,
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
  private publicFallbackAttempted = false
  private staleRefreshAt = 0
  private staleCheckDone = false
  private emptyLoadMoreStreak = 0
  private skipPersistedSince = false
  private previousSubscriptionKey?: string
  private previousActiveUrlsKey?: string
  private pendingLive: Event[] = []

  constructor(private readonly options: HomeFeedEngineOptions) {}

  getSnapshot(): HomeFeedEngineSnapshot {
    return {
      rawEvents: this.rawEvents,
      loading: this.loading,
      loadingMore: this.loadingMore,
      hasMore: this.hasMore,
      timelineKey: this.timelineKey,
      relayOutcomes: this.relayOutcomes,
      error: this.error,
      generation: this.generation
    }
  }

  private emit() {
    this.options.onChange(this.getSnapshot())
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

  async start(refresh = false): Promise<void> {
    this.closeSubscription()
    const gen = ++this.generation
    const { bundle, client, sessionSnapshotKey } = this.options

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
        this.emit()
      } else {
        this.rawEvents = preserve ? this.rawEvents : []
      }
    } else if (refresh) {
      this.rawEvents = []
    }

    this.loading = true
    this.hasMore = true
    this.error = undefined
    this.relayOutcomes = []
    this.emit()

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
      this.loading = false
      this.hasMore = false
      this.emit()
      return
    }

    if (client.getTimelineDiskSnapshotEvents && this.rawEvents.length === 0) {
      try {
        const disk = await client.getTimelineDiskSnapshotEvents(asTimelineSubRequests(mapped))
        if (gen !== this.generation) return
        if (disk.length > 0) {
          this.rawEvents = mergeEventsById(this.rawEvents, disk, HOME_FEED_EVENT_CAP)
          this.emit()
        }
      } catch {
        /* optional disk prime */
      }
    }

    try {
      const result = await client.subscribeTimeline(
        asTimelineSubRequests(mapped),
        {
          onEvents: (events, _eosed) => {
            if (gen !== this.generation) return
            if (events.length === 0) return
            this.rawEvents = mergeEventsById(this.rawEvents, events, HOME_FEED_EVENT_CAP)
            this.loading = false
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
            this.rawEvents = mergeEventsById([evt, ...this.rawEvents], [], HOME_FEED_EVENT_CAP)
            this.emit()
          }
        },
        {
          relayAuthoritativeTimeline: bundle.relaySetFeedOnly,
          feedScopeKey: bundle.subscriptionKey,
          onRelaySubscribeWaveComplete: (rows) => {
            if (gen !== this.generation) return
            this.relayOutcomes = rows
            this.loading = false
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
      this.loading = false
      this.emit()
    } catch (e) {
      if (gen !== this.generation) return
      this.error = e instanceof Error ? e.message : String(e)
      this.loading = false
      this.emit()
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
    this.persistSession()
    this.generation++
  }

  refresh(): void {
    void this.start(true)
  }

  flushPendingLive(): void {
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
