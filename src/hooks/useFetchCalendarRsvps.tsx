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

/** NIP-65 inboxes only — calendar RSVPs are published to the author’s outboxes, so REQ must include those too. */
function userWriteRelaysForQuery(
  relayList: { write?: string[]; httpWrite?: string[] } | null | undefined
): string[] {
  if (!relayList) return []
  const ws = (relayList.write ?? [])
    .map((url) => normalizeAnyRelayUrl(url) || url)
    .filter(Boolean) as string[]
  const http = (relayList.httpWrite ?? [])
    .map((url) => normalizeAnyRelayUrl(url) || url)
    .filter(Boolean) as string[]
  return [...http, ...ws]
}

function getRsvpStatus(rsvp: Event): 'accepted' | 'tentative' | 'declined' | undefined {
  const status = rsvp.tags.find(tagNameEquals('status'))?.[1]
  if (status === 'accepted' || status === 'tentative' || status === 'declined') return status
  return undefined
}

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
    const userWrite = userWriteRelaysForQuery(relayList)

    void (async () => {
      const fromSession = client.getSessionCalendarRsvpsForCalendarEvent(calendarEvent)
      setRsvps(mergeRsvpList(fromSession))

      const idbP = indexedDb
        .getCalendarRsvpEventsByParentCoordinate(coordinate)
        .catch((): Event[] => [])

      void idbP.then((rows) => {
        if (cancelled) return
        setRsvps(mergeRsvpList([...rows, ...fromSession]))
      })

      const baseUrls = new Set<string>([
        ...FAST_READ_RELAY_URLS.map((url) => normalizeAnyRelayUrl(url) || url),
        ...userRead.map((url) => normalizeAnyRelayUrl(url) || url),
        ...userWrite.map((url) => normalizeAnyRelayUrl(url) || url)
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
        const calendarHexId = /^[0-9a-f]{64}$/i.test(calendarEvent.id)
          ? calendarEvent.id.toLowerCase()
          : calendarEvent.id
        const events = await queryService.fetchEvents(
          urls,
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
        const fromRelay = events ?? []
        const fromIdb = await idbP
        await Promise.allSettled(
          fromRelay.map((ev) => indexedDb.putCalendarRsvpEventRow(ev).catch(() => undefined))
        )
        setRsvps(mergeRsvpList([...fromIdb, ...fromSession, ...fromRelay]))
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
    const calId = /^[0-9a-f]{64}$/i.test(calendarEvent.id)
      ? calendarEvent.id.toLowerCase()
      : calendarEvent.id
    const handler = (e: CustomEvent<Event>) => {
      const evt = e.detail
      if (evt.kind !== ExtendedKind.CALENDAR_EVENT_RSVP) return
      const aTag = evt.tags.find(tagNameEquals('a'))
      const aCoord = aTag?.[1] ? normalizeReplaceableCoordinateString(aTag[1]) : ''
      const eTag = evt.tags.find(tagNameEquals('e'))?.[1]?.trim().toLowerCase()
      const matchesA = aCoord !== '' && aCoord === coordinate
      const matchesE = eTag && /^[0-9a-f]{64}$/.test(eTag) && eTag === calId
      if (!matchesA && !matchesE) return
      void indexedDb.putCalendarRsvpEventRow(evt).catch(() => undefined)
      setRsvps((prev) => mergeRsvp(prev, evt))
    }

    client.addEventListener('newEvent', handler as EventListener)
    return () => client.removeEventListener('newEvent', handler as EventListener)
  }, [calendarEvent?.id, calendarEvent?.kind, calendarEvent?.pubkey])

  return {
    rsvps,
    isFetching,
    getRsvpStatus
  }
}
