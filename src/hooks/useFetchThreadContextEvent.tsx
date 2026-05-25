import { THREAD_CONTEXT_EVENT_FETCH_GLOBAL_TIMEOUT_MS } from '@/constants'
import { getAggrAwareSearchRelayUrls } from '@/lib/nostr-land-relay-eligibility'
import { sanitizeRelayUrlsForFetch } from '@/lib/read-only-relay-personal'
import { resolveThreadContextEventFromLocalStores } from '@/lib/thread-context-local'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useIsEventDeleted } from '@/providers/DeletedEventProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useReplyIngress } from '@/hooks/useReplyIngress'
import { getParentETag, getRootETag } from '@/lib/event'
import { buildThreadContextFetchRelayUrls } from '@/lib/thread-context-relays'
import client, { eventService } from '@/services/client.service'
import { Event } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useState } from 'react'

export type ThreadContextRole = 'parent' | 'root'

/** First usable event from parallel fetches, or undefined after all settle or `timeoutMs`. */
function raceThreadContextFetches(
  tasks: Array<() => Promise<Event | undefined>>,
  timeoutMs: number
): Promise<Event | undefined> {
  if (tasks.length === 0) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(undefined), timeoutMs)
    let settled = 0
    const finish = (ev: Event | undefined) => {
      settled++
      if (ev) {
        window.clearTimeout(timer)
        resolve(ev)
        return
      }
      if (settled === tasks.length) {
        window.clearTimeout(timer)
        resolve(undefined)
      }
    }
    for (const run of tasks) {
      void run().then(finish).catch(() => finish(undefined))
    }
  })
}

export function useFetchThreadContextEvent(
  eventId: string | undefined,
  contextEvent: Event | undefined,
  role: ThreadContextRole,
  initialEvent?: Event
) {
  const { pubkey: viewerPubkey } = useNostr()
  const { blockedRelays } = useFavoriteRelays()
  const isEventDeleted = useIsEventDeleted()
  const { addReplies } = useReplyIngress()
  const [error, setError] = useState<Error | null>(null)
  const [event, setEvent] = useState<Event | undefined>(initialEvent)
  const [isFetching, setIsFetching] = useState(!initialEvent)
  const [refetchToken, setRefetchToken] = useState(0)

  const refetch = useCallback(() => {
    setRefetchToken((n) => n + 1)
  }, [])

  const targetTag = useMemo(() => {
    if (!contextEvent) return undefined
    return role === 'parent' ? getParentETag(contextEvent) : getRootETag(contextEvent)
  }, [contextEvent, role])

  const blockedKey = useMemo(
    () => [...blockedRelays].map((u) => u).sort().join('\0'),
    [blockedRelays]
  )

  useEffect(() => {
    let cancelled = false

    if (!eventId || !contextEvent) {
      setIsFetching(false)
      setEvent(initialEvent)
      return () => {
        cancelled = true
      }
    }

    const skipShortcuts = refetchToken > 0

    void (async () => {
      if (!skipShortcuts) {
        const local = await resolveThreadContextEventFromLocalStores(eventId, initialEvent)
        if (cancelled) return
        if (local && !isEventDeleted(local)) {
          setEvent(local)
          addReplies([local])
          setIsFetching(false)
          return
        }
      }

      setEvent(undefined)
      setError(null)
      setIsFetching(true)

      try {
        const relayUrls = await buildThreadContextFetchRelayUrls(
          contextEvent,
          targetTag,
          viewerPubkey ?? undefined,
          blockedRelays
        )
        const threadOpts = relayUrls.length
          ? { relayHints: relayUrls, threadContext: true as const }
          : { threadContext: true as const }

        const fetchParentOrRoot = () => {
          if (skipShortcuts) {
            return eventService.fetchEventForceRetry(eventId, threadOpts)
          }
          return eventService.fetchEvent(eventId, threadOpts)
        }

        const aggrAwareSearch = sanitizeRelayUrlsForFetch(getAggrAwareSearchRelayUrls())
        const tasks: Array<() => Promise<Event | undefined>> = [fetchParentOrRoot]
        if (aggrAwareSearch.length > 0) {
          tasks.push(async () => {
            const ev = await client.fetchEventWithExternalRelays(eventId, aggrAwareSearch)
            if (ev) client.addEventToCache(ev)
            return ev
          })
        }

        const fetchedEvent = await raceThreadContextFetches(
          tasks,
          THREAD_CONTEXT_EVENT_FETCH_GLOBAL_TIMEOUT_MS
        )

        if (cancelled) return
        if (fetchedEvent && !isEventDeleted(fetchedEvent)) {
          setEvent(fetchedEvent)
          addReplies([fetchedEvent])
        } else {
          setEvent(undefined)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err as Error)
          setEvent(undefined)
        }
      } finally {
        if (!cancelled) {
          setIsFetching(false)
        }
      }
    })()

    return () => {
      cancelled = true
      setIsFetching(false)
    }
  }, [
    eventId,
    contextEvent,
    targetTag,
    initialEvent,
    isEventDeleted,
    addReplies,
    refetchToken,
    viewerPubkey,
    blockedKey,
    role
  ])

  useEffect(() => {
    if (event && isEventDeleted(event)) {
      setEvent(undefined)
    }
  }, [isEventDeleted, event])

  useEffect(() => {
    if (!eventId || event !== undefined) return undefined
    return eventService.subscribeWhenSessionHasEvent(eventId, refetch)
  }, [eventId, event, refetch])

  return { isFetching, error, event, refetch }
}
