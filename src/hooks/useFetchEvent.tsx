import { getNoteBech32Id } from '@/lib/event'
import { useDeletedEvent } from '@/providers/DeletedEventProvider'
import { useReply } from '@/providers/ReplyProvider'
import { eventService } from '@/services/client.service'
import { navigationEventStore } from '@/services/navigation-event-store'
import { Event } from 'nostr-tools'
import { useCallback, useEffect, useState } from 'react'

export function useFetchEvent(
  eventId?: string,
  initialEvent?: Event,
  fetchOpts?: { relayHints?: string[] }
) {
  const { isEventDeleted } = useDeletedEvent()
  const { addReplies } = useReply()
  const [error, setError] = useState<Error | null>(null)
  const [event, setEvent] = useState<Event | undefined>(initialEvent)
  const [isFetching, setIsFetching] = useState(!initialEvent)
  const [refetchToken, setRefetchToken] = useState(0)

  const refetch = useCallback(() => {
    setRefetchToken((n) => n + 1)
  }, [])

  /** Content-based key so a new `relayHints` array with the same URLs does not restart the fetch. */
  const relayHintsSerialized = fetchOpts?.relayHints?.join('\0') ?? ''

  useEffect(() => {
    let cancelled = false

    if (!eventId) {
      setIsFetching(false)
      setEvent(undefined)
      // Do not setError here: this effect re-runs when callback deps (e.g. addReplies) change identity;
      // allocating a new Error each time would force updates and can exceed React's max update depth.
      return () => {
        cancelled = true
      }
    }

    const skipShortcuts = refetchToken > 0

    // If we have an initial event that matches the eventId, use it and skip fetching
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

    // Check navigation event store first (events passed through navigation) — peek so remounts still see it.
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

    // New target without a synchronous hit: drop the previous note immediately so the panel does not
    // keep showing the last-opened article (or fail to show a skeleton) while the new fetch runs or
    // after it returns empty.
    setEvent(undefined)
    setError(null)
    setIsFetching(true)

    const fetchEvent = async () => {
      try {
        // First load: DataLoader dedupes. Refetches (incl. session-waiter) clear a prior undefined so
        // timeline-cached events resolve after the embed mounted first.
        const opts = fetchOpts?.relayHints?.length ? fetchOpts : undefined
        const fetchedEvent = skipShortcuts
          ? await eventService.fetchEventForceRetry(eventId, opts)
          : await eventService.fetchEvent(eventId, opts)
        if (cancelled) return
        if (fetchedEvent && !isEventDeleted(fetchedEvent)) {
          setEvent(fetchedEvent)
          addReplies([fetchedEvent])
        } else {
          setEvent(undefined)
        }
      } catch (error) {
        if (!cancelled) {
          setError(error as Error)
          setEvent(undefined)
        }
      } finally {
        if (!cancelled) {
          setIsFetching(false)
        }
      }
    }

    void fetchEvent()

    return () => {
      cancelled = true
      // If deps change (e.g. embed relay hints) or Strict Mode re-runs the effect while a fetch is
      // still in flight, `finally` skips `setIsFetching(false)` when `cancelled` — without this,
      // loading can stay true forever and embeds show an endless skeleton.
      setIsFetching(false)
    }
  }, [eventId, initialEvent, isEventDeleted, addReplies, refetchToken, relayHintsSerialized])

  useEffect(() => {
    if (event && isEventDeleted(event)) {
      setEvent(undefined)
    }
  }, [isEventDeleted, event])

  // Parent notes often render before the embedded event arrives from the same timeline; refetch when it hits session cache.
  useEffect(() => {
    if (!eventId || event !== undefined) return undefined
    return eventService.subscribeWhenSessionHasEvent(eventId, refetch)
  }, [eventId, event, refetch])

  return { isFetching, error, event, refetch }
}
