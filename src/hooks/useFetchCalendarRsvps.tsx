import { ExtendedKind } from '@/constants'
import {
  getReplaceableCoordinateFromEvent,
  normalizeReplaceableCoordinateString
} from '@/lib/event'
import { isCalendarEventKind } from '@/lib/calendar-event'
import client from '@/services/client.service'
import { queryService } from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { useNostr } from '@/providers/NostrProvider'
import { Event } from 'nostr-tools'
import { useEffect, useState } from 'react'
import { normalizeAnyRelayUrl } from '@/lib/url'
import { FAST_READ_RELAY_URLS } from '@/constants'
import { userReadRelaysWithHttp } from '@/lib/favorites-feed-relays'
import { tagNameEquals } from '@/lib/tag'

function getRsvpStatus(rsvp: Event): 'accepted' | 'tentative' | 'declined' | undefined {
  const status = rsvp.tags.find(tagNameEquals('status'))?.[1]
  if (status === 'accepted' || status === 'tentative' || status === 'declined') return status
  return undefined
}

function mergeRsvp(prev: Event[], evt: Event): Event[] {
  const next = prev.filter((e) => e.id !== evt.id)
  const samePubkey = next.find((e) => e.pubkey === evt.pubkey)
  if (samePubkey && samePubkey.created_at >= evt.created_at) return next
  const withoutSamePubkey = samePubkey ? next.filter((e) => e.pubkey !== evt.pubkey) : next
  return [...withoutSamePubkey, evt].sort((a, b) => b.created_at - a.created_at)
}

/** Apply RSVPs in time order so the latest per pubkey wins (matches relay merge semantics). */
function mergeRsvpList(events: Event[]): Event[] {
  const asc = [...events].sort((a, b) => a.created_at - b.created_at)
  let acc: Event[] = []
  for (const e of asc) acc = mergeRsvp(acc, e)
  return acc
}

export function useFetchCalendarRsvps(calendarEvent: Event | undefined) {
  const { relayList } = useNostr()
  const [rsvps, setRsvps] = useState<Event[]>([])
  const [isFetching, setIsFetching] = useState(false)

  useEffect(() => {
    if (!calendarEvent || !isCalendarEventKind(calendarEvent.kind)) {
      setRsvps([])
      return
    }

    let cancelled = false
    setIsFetching(true)

    const coordinate = normalizeReplaceableCoordinateString(
      getReplaceableCoordinateFromEvent(calendarEvent)
    )
    const userRead = userReadRelaysWithHttp(relayList)

    void (async () => {
      let fromIdb: Event[] = []
      try {
        fromIdb = await indexedDb.getCalendarRsvpEventsByParentCoordinate(coordinate)
      } catch {
        fromIdb = []
      }
      if (cancelled) return
      if (fromIdb.length) setRsvps(fromIdb)

      const baseUrls = new Set<string>([
        ...FAST_READ_RELAY_URLS.map((url) => normalizeAnyRelayUrl(url) || url),
        ...userRead.map((url) => normalizeAnyRelayUrl(url) || url)
      ].filter(Boolean) as string[])

      const organizerPubkey = calendarEvent.pubkey
      try {
        let relayUrls: string[]
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
          relayUrls = Array.from(baseUrls)
        } catch {
          relayUrls = Array.from(baseUrls)
        }
        if (cancelled) return
        const urls = relayUrls?.length ? relayUrls : Array.from(baseUrls)
        const events = await queryService.fetchEvents(
          urls,
          {
            kinds: [ExtendedKind.CALENDAR_EVENT_RSVP],
            '#a': [coordinate],
            limit: 200
          },
          { firstRelayResultGraceMs: false }
        )
        if (cancelled) return
        setRsvps(mergeRsvpList([...fromIdb, ...(events ?? [])]))
      } finally {
        if (!cancelled) setIsFetching(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [calendarEvent?.id, calendarEvent?.kind, calendarEvent?.pubkey, relayList])

  // When we publish an RSVP, NostrProvider calls client.emitNewEvent(event). Merge it into rsvps so the UI updates immediately.
  useEffect(() => {
    if (!calendarEvent || !isCalendarEventKind(calendarEvent.kind)) return

    const coordinate = normalizeReplaceableCoordinateString(
      getReplaceableCoordinateFromEvent(calendarEvent)
    )
    const handler = (e: CustomEvent<Event>) => {
      const evt = e.detail
      if (evt.kind !== ExtendedKind.CALENDAR_EVENT_RSVP) return
      const aTag = evt.tags.find(tagNameEquals('a'))
      const aCoord = aTag?.[1] ? normalizeReplaceableCoordinateString(aTag[1]) : ''
      if (aCoord !== coordinate) return
      setRsvps((prev) => mergeRsvp(prev, evt))
    }

    client.addEventListener('newEvent', handler as EventListener)
    return () => client.removeEventListener('newEvent', handler as EventListener)
  }, [calendarEvent?.id, calendarEvent?.kind])

  return {
    rsvps,
    isFetching,
    getRsvpStatus
  }
}
