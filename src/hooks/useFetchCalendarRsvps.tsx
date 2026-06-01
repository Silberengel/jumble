import { ExtendedKind } from '@/constants'
import { isCalendarEventKind } from '@/lib/calendar-event'
import {
  calendarEventHexId,
  calendarRsvpMatchesCalendarEvent,
  parseCalendarRsvpStatus
} from '@/lib/calendar-rsvp-match'
import {
  getReplaceableCoordinateFromEvent,
  normalizeReplaceableCoordinateString
} from '@/lib/event'
import { relayHintsFromEventTags } from '@/lib/relay-list-builder'
import client, { queryService } from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { useNostr } from '@/providers/NostrProvider'
import { Event } from 'nostr-tools'
import { useCallback, useEffect, useState } from 'react'
import { normalizeAnyRelayUrl } from '@/lib/url'
import { FAST_READ_RELAY_URLS } from '@/constants'
import { userReadInboxUrls, userWriteOutboxUrls } from '@/lib/favorites-feed-relays'

function mergeRsvp(prev: Event[], evt: Event): Event[] {
  const next = prev.filter((e) => e.id !== evt.id)
  const pk = evt.pubkey.toLowerCase()
  const samePubkey = next.find((e) => e.pubkey.toLowerCase() === pk)
  if (samePubkey && samePubkey.created_at >= evt.created_at) return next
  const withoutSamePubkey = samePubkey ? next.filter((e) => e.pubkey.toLowerCase() !== pk) : next
  return [...withoutSamePubkey, evt].sort((a, b) => b.created_at - a.created_at)
}

/** Apply RSVPs in time order so the latest per pubkey wins (matches relay merge semantics). */
function mergeRsvpList(events: Event[]): Event[] {
  const asc = [...events].sort((a, b) => a.created_at - b.created_at)
  let acc: Event[] = []
  for (const e of asc) acc = mergeRsvp(acc, e)
  return acc
}

function filterMatchingRsvps(calendarEvent: Event, events: Event[]): Event[] {
  return events.filter((ev) => calendarRsvpMatchesCalendarEvent(calendarEvent, ev))
}

export function useFetchCalendarRsvps(calendarEvent: Event | undefined) {
  const { relayList, cacheRelayListEvent } = useNostr()
  const [rsvps, setRsvps] = useState<Event[]>([])
  const [isFetching, setIsFetching] = useState(false)

  const applyRsvp = useCallback(
    (evt: Event) => {
      if (!calendarEvent || !isCalendarEventKind(calendarEvent.kind)) return
      if (!calendarRsvpMatchesCalendarEvent(calendarEvent, evt)) return
      void indexedDb.putCalendarRsvpEventRow(evt).catch(() => undefined)
      setRsvps((prev) => mergeRsvp(prev, evt))
    },
    [calendarEvent]
  )

  useEffect(() => {
    if (!calendarEvent || !isCalendarEventKind(calendarEvent.kind)) {
      setRsvps([])
      return
    }

    let cancelled = false
    setIsFetching(true)

    const userRead = userReadInboxUrls(relayList, cacheRelayListEvent)
    const userWrite = userWriteOutboxUrls(relayList, cacheRelayListEvent)

    void (async () => {
      const fromSession = filterMatchingRsvps(
        calendarEvent,
        client.getSessionCalendarRsvpsForCalendarEvent(calendarEvent)
      )
      setRsvps(mergeRsvpList(fromSession))

      const idbP = indexedDb
        .getCalendarRsvpEventsForCalendarEvent(calendarEvent)
        .catch((): Event[] => [])

      void idbP.then((rows) => {
        if (cancelled) return
        setRsvps(mergeRsvpList(filterMatchingRsvps(calendarEvent, [...rows, ...fromSession])))
      })

      const baseUrls = new Set<string>([
        ...FAST_READ_RELAY_URLS.map((url) => normalizeAnyRelayUrl(url) || url),
        ...userRead.map((url) => normalizeAnyRelayUrl(url) || url),
        ...userWrite.map((url) => normalizeAnyRelayUrl(url) || url),
        ...relayHintsFromEventTags(calendarEvent).map((url) => normalizeAnyRelayUrl(url) || url),
        ...client.getSeenEventRelayUrls(calendarEvent.id).map((url) => normalizeAnyRelayUrl(url) || url)
      ].filter(Boolean) as string[])

      const organizerPubkey = calendarEvent.pubkey
      try {
        try {
          const organizerRelays = await client.fetchRelayList(organizerPubkey)
          if (!cancelled) {
            ;[
              ...(organizerRelays?.httpRead ?? []),
              ...(organizerRelays?.read ?? []),
              ...(organizerRelays?.httpWrite ?? []),
              ...(organizerRelays?.write ?? [])
            ].forEach((url) => {
              const u = normalizeAnyRelayUrl(url)
              if (u) baseUrls.add(u)
            })
          }
        } catch {
          // keep baseUrls
        }
        if (cancelled) return

        const coordinate = normalizeReplaceableCoordinateString(
          getReplaceableCoordinateFromEvent(calendarEvent)
        )
        const calendarHexId = calendarEventHexId(calendarEvent)
        const events = await queryService.fetchEvents(
          Array.from(baseUrls),
          [
            {
              kinds: [ExtendedKind.CALENDAR_EVENT_RSVP],
              '#a': [coordinate],
              limit: 200
            },
            {
              kinds: [ExtendedKind.CALENDAR_EVENT_RSVP],
              '#e': [calendarHexId],
              limit: 200
            }
          ],
          {
            firstRelayResultGraceMs: false,
            eoseTimeout: 4500,
            globalTimeout: 24_000
          }
        )
        if (cancelled) return
        const fromRelay = filterMatchingRsvps(calendarEvent, events ?? [])
        const fromIdb = await idbP
        await Promise.allSettled(
          fromRelay.map((ev) => indexedDb.putCalendarRsvpEventRow(ev).catch(() => undefined))
        )
        setRsvps(
          mergeRsvpList(
            filterMatchingRsvps(calendarEvent, [...fromIdb, ...fromSession, ...fromRelay])
          )
        )
      } finally {
        if (!cancelled) setIsFetching(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [calendarEvent, relayList, cacheRelayListEvent])

  useEffect(() => {
    if (!calendarEvent || !isCalendarEventKind(calendarEvent.kind)) return

    const handler = (e: CustomEvent<Event>) => {
      applyRsvp(e.detail)
    }

    client.addEventListener('newEvent', handler as EventListener)
    return () => client.removeEventListener('newEvent', handler as EventListener)
  }, [calendarEvent, applyRsvp])

  return {
    rsvps,
    isFetching,
    getRsvpStatus: parseCalendarRsvpStatus,
    applyRsvp
  }
}
