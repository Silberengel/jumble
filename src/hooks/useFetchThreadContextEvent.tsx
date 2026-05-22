import { THREAD_CONTEXT_EVENT_FETCH_GLOBAL_TIMEOUT_MS } from '@/constants'
import { getAggrAwareSearchRelayUrls } from '@/lib/nostr-land-relay-eligibility'
import { sanitizeRelayUrlsForFetch } from '@/lib/read-only-relay-personal'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useDeletedEvent } from '@/providers/DeletedEventProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useReply } from '@/providers/ReplyProvider'
import { getNoteBech32Id, getParentETag, getRootETag } from '@/lib/event'
import { buildThreadContextFetchRelayUrls } from '@/lib/thread-context-relays'
import client, { eventService } from '@/services/client.service'
import { navigationEventStore } from '@/services/navigation-event-store'
import { Event } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type ThreadContextRole = 'parent' | 'root'

export function useFetchThreadContextEvent(
  eventId: string | undefined,
  contextEvent: Event | undefined,
  role: ThreadContextRole,
  initialEvent?: Event
) {
  const { pubkey: viewerPubkey } = useNostr()
  const { blockedRelays } = useFavoriteRelays()
  const { isEventDeleted } = useDeletedEvent()
  const { addReplies } = useReply()
  const [error, setError] = useState<Error | null>(null)
  const [event, setEvent] = useState<Event | undefined>(initialEvent)
  const [isFetching, setIsFetching] = useState(!initialEvent)
  const [refetchToken, setRefetchToken] = useState(0)
  const searchableAttemptedRef = useRef(false)

  const refetch = useCallback(() => {
    searchableAttemptedRef.current = false
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
    searchableAttemptedRef.current = false
  }, [eventId])

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

    const initialMatches =
      initialEvent &&
      (initialEvent.id === eventId ||
        (() => {
          try {
            return getNoteBech32Id(initialEvent) === eventId
          } catch {
            return false
          }
        })())
    if (!skipShortcuts && initialMatches && initialEvent) {
      if (!isEventDeleted(initialEvent)) {
        setEvent(initialEvent)
        addReplies([initialEvent])
        setIsFetching(false)
      }
      return () => {
        cancelled = true
      }
    }

    if (!skipShortcuts) {
      const navigationEvent = navigationEventStore.peekEvent(eventId)
      if (navigationEvent && !isEventDeleted(navigationEvent)) {
        setEvent(navigationEvent)
        addReplies([navigationEvent])
        setIsFetching(false)
        return () => {
          cancelled = true
        }
      }
    }

    setEvent(undefined)
    setError(null)
    setIsFetching(true)

    const fetchWithFallback = async () => {
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

        const fetchParentOrRoot = async () => {
          if (skipShortcuts) {
            return eventService.fetchEventForceRetry(eventId, threadOpts)
          }
          return eventService.fetchEvent(eventId, threadOpts)
        }

        let fetchedEvent = await Promise.race([
          fetchParentOrRoot(),
          new Promise<undefined>((resolve) => {
            window.setTimeout(() => resolve(undefined), THREAD_CONTEXT_EVENT_FETCH_GLOBAL_TIMEOUT_MS)
          })
        ])

        const aggrAwareSearch = getAggrAwareSearchRelayUrls()
        if (!fetchedEvent && !searchableAttemptedRef.current && aggrAwareSearch.length > 0) {
          searchableAttemptedRef.current = true
          const searchable = sanitizeRelayUrlsForFetch(aggrAwareSearch)
          fetchedEvent = await Promise.race([
            client.fetchEventWithExternalRelays(eventId, searchable),
            new Promise<undefined>((resolve) => {
              window.setTimeout(() => resolve(undefined), THREAD_CONTEXT_EVENT_FETCH_GLOBAL_TIMEOUT_MS)
            })
          ])
          if (fetchedEvent) {
            client.addEventToCache(fetchedEvent)
          }
        }

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
    }

    void fetchWithFallback()

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
