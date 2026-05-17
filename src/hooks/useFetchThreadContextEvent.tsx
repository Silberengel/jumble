import { SEARCHABLE_RELAY_URLS } from '@/constants'
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
        const opts = relayUrls.length ? { relayHints: relayUrls } : undefined
        let fetchedEvent = skipShortcuts
          ? await eventService.fetchEventForceRetry(eventId, opts)
          : await eventService.fetchEvent(eventId, opts)

        if (
          !fetchedEvent &&
          !searchableAttemptedRef.current &&
          SEARCHABLE_RELAY_URLS.length > 0
        ) {
          searchableAttemptedRef.current = true
          fetchedEvent = await client.fetchEventWithExternalRelays(
            eventId,
            SEARCHABLE_RELAY_URLS
          )
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
