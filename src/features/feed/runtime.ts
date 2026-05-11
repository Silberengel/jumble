import type { Event } from 'nostr-tools'

export type FeedRelayOutcomeStatus =
  | 'event'
  | 'eose-empty'
  | 'closed'
  | 'auth-required'
  | 'timeout'
  | 'transport-error'

export type FeedRelayOutcome = {
  relayUrl: string
  status: FeedRelayOutcomeStatus
  message?: string
  eventCount?: number
}

export type FeedRuntimeStatus = 'idle' | 'loading' | 'refreshing' | 'ready' | 'empty' | 'error'
export type FeedRuntimePaginationStatus = 'idle' | 'loading' | 'exhausted' | 'error'
export type FeedRuntimeLoadPage = 'initial' | 'refresh' | 'load-more'

export type FeedRuntimeEmptyReason =
  | 'not-empty'
  | 'no-relay-success'
  | 'no-raw-events'
  | 'no-visible-events'
  | 'blocked-relays-only'
  | 'stale-cache-only'
  | 'error'

export type FeedRuntimeSnapshot = {
  generation: number
  status: FeedRuntimeStatus
  rows: Event[]
  stale: boolean
  rawCount: number
  visibleCount: number
  hiddenCount: number
  relayOutcomes: FeedRelayOutcome[]
  emptyReason: FeedRuntimeEmptyReason
  error?: string
  hasMore: boolean
  paginationStatus: FeedRuntimePaginationStatus
  nextCursor?: number
  pageError?: string
}

export type FeedRuntimeState = FeedRuntimeSnapshot & {
  descriptorKey: string
  rawRows: Event[]
}

export type FeedRuntimeAction =
  | { type: 'start'; descriptorKey: string; generation: number; refresh: boolean; keepRowsStale?: boolean }
  | { type: 'seed'; events: Event[]; stale?: boolean; hasMore?: boolean; nextCursor?: number }
  | { type: 'cache'; events: Event[]; stale: boolean }
  | { type: 'relayBatch'; events: Event[]; relayOutcomes?: FeedRelayOutcome[]; fresh?: boolean }
  | { type: 'relayDone'; relayOutcomes?: FeedRelayOutcome[]; hasMore?: boolean; nextCursor?: number }
  | { type: 'pageStart' }
  | {
      type: 'pageBatch'
      events: Event[]
      relayOutcomes?: FeedRelayOutcome[]
      hasMore?: boolean
      nextCursor?: number
    }
  | { type: 'pageError'; error: string; relayOutcomes?: FeedRelayOutcome[] }
  | { type: 'error'; error: string; relayOutcomes?: FeedRelayOutcome[] }
  | { type: 'reset'; descriptorKey: string }

export type FeedRuntimeOptions = {
  descriptorKey: string
  isVisibleEvent?: (event: Event) => boolean
  sortEvents?: (a: Event, b: Event) => number
  cap?: number
}

export type FeedRuntimeLoadResult = {
  cacheEvents?: Event[]
  cacheStale?: boolean
  relayEvents?: Event[]
  relayOutcomes?: FeedRelayOutcome[]
  hasMore?: boolean
  nextCursor?: number
}

export type FeedRuntimeSeedOptions = {
  stale?: boolean
  hasMore?: boolean
  nextCursor?: number
}

export type FeedRuntimeLoader = (args: {
  descriptorKey: string
  generation: number
  refresh: boolean
  page: FeedRuntimeLoadPage
  cursor?: number
  signal: AbortSignal
}) => Promise<FeedRuntimeLoadResult>

function defaultSort(a: Event, b: Event) {
  return b.created_at - a.created_at || b.id.localeCompare(a.id)
}

function mergeById(existing: readonly Event[], incoming: readonly Event[], sortEvents: (a: Event, b: Event) => number): Event[] {
  const byId = new Map<string, Event>()
  for (const evt of existing) byId.set(evt.id, evt)
  for (const evt of incoming) {
    const prev = byId.get(evt.id)
    if (!prev || evt.created_at >= prev.created_at) byId.set(evt.id, evt)
  }
  return [...byId.values()].sort(sortEvents)
}

function cursorFromEvents(events: readonly Event[]): number | undefined {
  if (!events.length) return undefined
  return Math.min(...events.map((event) => event.created_at)) - 1
}

function classifyEmpty(state: FeedRuntimeState): FeedRuntimeEmptyReason {
  if (state.stale && state.rawCount > 0) return 'stale-cache-only'
  if (state.visibleCount > 0) return 'not-empty'
  if (state.error) return 'error'
  if (state.rawCount === 0 && state.relayOutcomes.length === 0) return 'no-relay-success'
  if (state.rawCount === 0) return 'no-raw-events'
  return 'no-visible-events'
}

function derive(
  state: FeedRuntimeState,
  opts: Pick<FeedRuntimeOptions, 'isVisibleEvent' | 'sortEvents' | 'cap'>
): FeedRuntimeState {
  const isVisible = opts.isVisibleEvent ?? (() => true)
  const sortEvents = opts.sortEvents ?? defaultSort
  const sorted = [...state.rawRows].sort(sortEvents)
  const rawRows = typeof opts.cap === 'number' ? sorted.slice(0, opts.cap) : sorted
  const visibleRows = rawRows.filter(isVisible)
  const next: FeedRuntimeState = {
    ...state,
    rows: visibleRows,
    rawRows,
    rawCount: rawRows.length,
    visibleCount: visibleRows.length,
    hiddenCount: Math.max(0, rawRows.length - visibleRows.length)
  }
  const emptyReason = classifyEmpty(next)
  return {
    ...next,
    emptyReason,
    status:
      next.status === 'loading' || next.status === 'refreshing'
        ? next.status
        : next.visibleCount > 0
          ? 'ready'
        : emptyReason === 'not-empty'
          ? 'ready'
          : next.error
            ? 'error'
            : 'empty'
  }
}

export function createInitialFeedRuntimeState(descriptorKey: string): FeedRuntimeState {
  return {
    descriptorKey,
    generation: 0,
    status: 'idle',
    rows: [],
    rawRows: [],
    stale: false,
    rawCount: 0,
    visibleCount: 0,
    hiddenCount: 0,
    relayOutcomes: [],
    emptyReason: 'no-raw-events',
    hasMore: false,
    paginationStatus: 'idle'
  }
}

export function feedRuntimeReducer(
  state: FeedRuntimeState,
  action: FeedRuntimeAction,
  options: Pick<FeedRuntimeOptions, 'isVisibleEvent' | 'sortEvents' | 'cap'> = {}
): FeedRuntimeState {
  const sortEvents = options.sortEvents ?? defaultSort
  switch (action.type) {
    case 'reset':
      return createInitialFeedRuntimeState(action.descriptorKey)
    case 'seed':
      return derive(
        {
          ...state,
          rawRows: action.events,
          stale: action.stale ?? false,
          hasMore: action.hasMore ?? state.hasMore,
          nextCursor: action.nextCursor ?? state.nextCursor,
          paginationStatus: action.hasMore === false ? 'exhausted' : state.paginationStatus,
          pageError: undefined
        },
        options
      )
    case 'start': {
      const keepRows = action.keepRowsStale ? state.rawRows : []
      return derive(
        {
          ...state,
          descriptorKey: action.descriptorKey,
          generation: action.generation,
          status: action.refresh ? 'refreshing' : 'loading',
          rawRows: keepRows,
          stale: action.keepRowsStale ? true : false,
          relayOutcomes: [],
          error: undefined,
          hasMore: false,
          paginationStatus: 'idle',
          nextCursor: undefined,
          pageError: undefined
        },
        options
      )
    }
    case 'cache':
      return derive(
        {
          ...state,
          rawRows: mergeById(state.rawRows, action.events, sortEvents),
          stale: action.stale
        },
        options
      )
    case 'relayBatch':
      return derive(
        {
          ...state,
          rawRows: mergeById(state.rawRows, action.events, sortEvents),
          stale: action.fresh === false ? state.stale : false,
          relayOutcomes: action.relayOutcomes ?? state.relayOutcomes,
          error: undefined
        },
        options
      )
    case 'relayDone':
      return derive(
        {
          ...state,
          status: state.visibleCount > 0 ? 'ready' : 'empty',
          relayOutcomes: action.relayOutcomes ?? state.relayOutcomes,
          hasMore: action.hasMore ?? state.hasMore,
          paginationStatus:
            action.hasMore === false ? 'exhausted' : action.hasMore === true ? 'idle' : state.paginationStatus,
          nextCursor: action.nextCursor ?? state.nextCursor
        },
        options
      )
    case 'pageStart':
      return {
        ...state,
        paginationStatus: 'loading',
        pageError: undefined
      }
    case 'pageBatch':
      return derive(
        {
          ...state,
          rawRows: mergeById(state.rawRows, action.events, sortEvents),
          stale: false,
          relayOutcomes: action.relayOutcomes ?? state.relayOutcomes,
          hasMore: action.hasMore ?? state.hasMore,
          paginationStatus: action.hasMore === false ? 'exhausted' : 'idle',
          nextCursor: action.nextCursor ?? cursorFromEvents(action.events) ?? state.nextCursor,
          pageError: undefined
        },
        options
      )
    case 'pageError':
      return derive(
        {
          ...state,
          paginationStatus: 'error',
          pageError: action.error,
          relayOutcomes: action.relayOutcomes ?? state.relayOutcomes
        },
        options
      )
    case 'error':
      return derive(
        {
          ...state,
          status: 'error',
          error: action.error,
          relayOutcomes: action.relayOutcomes ?? state.relayOutcomes
        },
        options
      )
  }
}

export class FeedRuntime {
  private state: FeedRuntimeState
  private generation = 0
  private abortController: AbortController | null = null
  private pageAbortController: AbortController | null = null

  constructor(private readonly options: FeedRuntimeOptions) {
    this.state = createInitialFeedRuntimeState(options.descriptorKey)
  }

  snapshot(): FeedRuntimeSnapshot {
    const { descriptorKey: _descriptorKey, rawRows: _rawRows, ...snapshot } = this.state
    return snapshot
  }

  seed(events: Event[], options: FeedRuntimeSeedOptions = {}): FeedRuntimeSnapshot {
    this.state = feedRuntimeReducer(
      this.state,
      {
        type: 'seed',
        events,
        stale: options.stale,
        hasMore: options.hasMore,
        nextCursor: options.nextCursor
      },
      this.options
    )
    return this.snapshot()
  }

  async load(loader: FeedRuntimeLoader, refresh = false): Promise<FeedRuntimeSnapshot> {
    this.abortController?.abort()
    const generation = ++this.generation
    const abortController = new AbortController()
    this.abortController = abortController
    this.state = feedRuntimeReducer(
      this.state,
      {
        type: 'start',
        descriptorKey: this.options.descriptorKey,
        generation,
        refresh,
        keepRowsStale: refresh
      },
      this.options
    )
    try {
      const result = await loader({
        descriptorKey: this.options.descriptorKey,
        generation,
        refresh,
        page: refresh ? 'refresh' : 'initial',
        signal: abortController.signal
      })
      if (abortController.signal.aborted || generation !== this.generation) return this.snapshot()
      if (result.cacheEvents?.length) {
        this.state = feedRuntimeReducer(
          this.state,
          { type: 'cache', events: result.cacheEvents, stale: result.cacheStale ?? true },
          this.options
        )
      }
      if (result.relayEvents) {
        this.state = feedRuntimeReducer(
          this.state,
          {
            type: 'relayBatch',
            events: result.relayEvents,
            relayOutcomes: result.relayOutcomes,
            fresh: true
          },
          this.options
        )
      }
      this.state = feedRuntimeReducer(
        this.state,
        {
          type: 'relayDone',
          relayOutcomes: result.relayOutcomes,
          hasMore: result.hasMore,
          nextCursor: result.nextCursor ?? cursorFromEvents(result.relayEvents ?? [])
        },
        this.options
      )
    } catch (e) {
      if (!abortController.signal.aborted) {
        this.state = feedRuntimeReducer(
          this.state,
          { type: 'error', error: e instanceof Error ? e.message : String(e) },
          this.options
        )
      }
    }
    return this.snapshot()
  }

  async loadMore(loader: FeedRuntimeLoader): Promise<FeedRuntimeSnapshot> {
    if (!this.state.hasMore || this.state.paginationStatus === 'loading') return this.snapshot()
    this.pageAbortController?.abort()
    const generation = this.generation
    const pageAbortController = new AbortController()
    this.pageAbortController = pageAbortController
    this.state = feedRuntimeReducer(this.state, { type: 'pageStart' }, this.options)
    try {
      const result = await loader({
        descriptorKey: this.options.descriptorKey,
        generation,
        refresh: false,
        page: 'load-more',
        cursor: this.state.nextCursor,
        signal: pageAbortController.signal
      })
      if (pageAbortController.signal.aborted || generation !== this.generation) return this.snapshot()
      this.state = feedRuntimeReducer(
        this.state,
        {
          type: 'pageBatch',
          events: result.relayEvents ?? [],
          relayOutcomes: result.relayOutcomes,
          hasMore: result.hasMore,
          nextCursor: result.nextCursor
        },
        this.options
      )
    } catch (e) {
      if (!pageAbortController.signal.aborted) {
        this.state = feedRuntimeReducer(
          this.state,
          { type: 'pageError', error: e instanceof Error ? e.message : String(e) },
          this.options
        )
      }
    }
    return this.snapshot()
  }

  abort() {
    this.abortController?.abort()
    this.pageAbortController?.abort()
    this.abortController = null
    this.pageAbortController = null
  }
}
