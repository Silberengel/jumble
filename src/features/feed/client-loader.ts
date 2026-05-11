import type { TSubRequestFilter } from '@/types'
import type { Event, Filter } from 'nostr-tools'
import type { FeedRuntimeLoader, FeedRuntimeLoadResult } from './runtime'

export type FeedLoaderSubRequest = {
  urls: string[]
  filter: Filter
}

export type FeedEventsClient = {
  fetchEvents: (
    urls: string[],
    filter: Filter | Filter[],
    options?: {
      cache?: boolean
      globalTimeout?: number
      eoseTimeout?: number
      firstRelayResultGraceMs?: number | false
    }
  ) => Promise<Event[]>
  getTimelineDiskSnapshotEvents?: (subRequests: { urls: string[]; filter: TSubRequestFilter }[]) => Promise<Event[]>
}

export type FetchEventsFeedLoaderOptions = {
  subRequests: readonly FeedLoaderSubRequest[]
  cache?: boolean
  hydrateFromDisk?: boolean
  globalTimeout?: number
  eoseTimeout?: number
  firstRelayResultGraceMs?: number | false
}

function filterWithCursor(filter: Filter, cursor: number | undefined): Filter {
  if (cursor === undefined) return filter
  const currentUntil = typeof filter.until === 'number' ? filter.until : cursor
  return {
    ...filter,
    until: Math.min(currentUntil, cursor)
  }
}

export function applyFeedCursorToRequests(
  subRequests: readonly FeedLoaderSubRequest[],
  cursor: number | undefined
): FeedLoaderSubRequest[] {
  return subRequests.map((request) => ({
    ...request,
    filter: filterWithCursor(request.filter, cursor)
  }))
}

export function createFetchEventsFeedRuntimeLoader(
  client: FeedEventsClient,
  options: FetchEventsFeedLoaderOptions
): FeedRuntimeLoader {
  return async ({ page, cursor, signal }): Promise<FeedRuntimeLoadResult> => {
    const requests = applyFeedCursorToRequests(options.subRequests, page === 'load-more' ? cursor : undefined)
    const cacheEvents =
      page !== 'load-more' && options.hydrateFromDisk && client.getTimelineDiskSnapshotEvents
        ? await client.getTimelineDiskSnapshotEvents(
            requests as Array<{ urls: string[]; filter: TSubRequestFilter }>
          )
        : undefined

    if (signal.aborted) return { cacheEvents, cacheStale: true, relayEvents: [] }

    const batches = await Promise.all(
      requests.map(({ urls, filter }) =>
        client.fetchEvents(urls, filter as Filter, {
          cache: options.cache,
          globalTimeout: options.globalTimeout,
          eoseTimeout: options.eoseTimeout,
          firstRelayResultGraceMs: options.firstRelayResultGraceMs
        })
      )
    )
    const byId = new Map<string, Event>()
    for (const event of batches.flat()) byId.set(event.id, event)
    const relayEvents = [...byId.values()]
    return {
      cacheEvents,
      cacheStale: cacheEvents ? true : undefined,
      relayEvents,
      hasMore: relayEvents.length > 0
    }
  }
}
