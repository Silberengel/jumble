import {
  noteEventNeedsRelayFetch,
  resolveNoteEventBeforeRelayFetch
} from '@/lib/fetch-note-event-layers'
import { resolveNoteEventSync } from '@/lib/resolve-note-event-sync'
import { useIsEventDeleted } from '@/providers/DeletedEventProvider'
import { useReplyIngress } from '@/hooks/useReplyIngress'
import { eventService } from '@/services/client.service'
import { Event } from 'nostr-tools'
import { useCallback, useEffect, useState } from 'react'

export function useFetchEvent(
  eventId?: string,
  initialEvent?: Event,
  fetchOpts?: { relayHints?: string[] }
) {
  const isEventDeleted = useIsEventDeleted()
  const { addReplies } = useReplyIngress()
  const [error, setError] = useState<Error | null>(null)
  const [event, setEvent] = useState<Event | undefined>(() =>
    eventId ? resolveNoteEventSync(eventId, initialEvent) : initialEvent
  )
  const [isFetching, setIsFetching] = useState(() => noteEventNeedsRelayFetch(eventId, initialEvent))
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

    if (!skipShortcuts) {
      const syncHit = resolveNoteEventSync(eventId, initialEvent)
      if (syncHit && !isEventDeleted(syncHit)) {
        setEvent(syncHit)
        addReplies([syncHit])
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
        if (!skipShortcuts) {
          const fromLocal = await resolveNoteEventBeforeRelayFetch(
            eventId,
            initialEvent,
            isEventDeleted
          )
          if (cancelled) return
          if (fromLocal) {
            setEvent(fromLocal)
            addReplies([fromLocal])
            setIsFetching(false)
            return
          }
          // Archives REST is already tried inside resolveThreadContextEventFromLocalStores.
        }

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
