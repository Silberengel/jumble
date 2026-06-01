import { ExtendedKind } from '@/constants'
import {
  getReplaceableCoordinateFromEvent,
  normalizeReplaceableCoordinateString
} from '@/lib/event'
import { tagNameEquals } from '@/lib/tag'
import { Event } from 'nostr-tools'

export type CalendarRsvpStatus = 'accepted' | 'tentative' | 'declined'

export function calendarEventHexId(event: Event): string {
  return /^[0-9a-f]{64}$/i.test(event.id) ? event.id.toLowerCase() : event.id
}

/** Whether kind 31925 references this calendar note (31922 / 31923) via `a` and/or `e`. */
export function calendarRsvpMatchesCalendarEvent(calendarEvent: Event, rsvp: Event): boolean {
  if (rsvp.kind !== ExtendedKind.CALENDAR_EVENT_RSVP) return false
  const coordNorm = normalizeReplaceableCoordinateString(
    getReplaceableCoordinateFromEvent(calendarEvent)
  )
  const calId = calendarEventHexId(calendarEvent)
  const rawA = rsvp.tags.find(tagNameEquals('a'))?.[1]?.trim()
  if (rawA && normalizeReplaceableCoordinateString(rawA) === coordNorm) return true
  const eTag = rsvp.tags.find(tagNameEquals('e'))?.[1]?.trim().toLowerCase()
  return Boolean(eTag && /^[0-9a-f]{64}$/.test(eTag) && eTag === calId)
}

export function parseCalendarRsvpStatus(rsvp: Event): CalendarRsvpStatus | undefined {
  const status = rsvp.tags.find(tagNameEquals('status'))?.[1]?.trim().toLowerCase()
  if (status === 'accepted' || status === 'tentative' || status === 'declined') return status
  return undefined
}

/** IndexedDB parent key for RSVPs that only tag the calendar event id (`e`). */
export function calendarRsvpParentKeyFromEventId(hexId: string): string {
  const id = hexId.trim().toLowerCase()
  return /^[0-9a-f]{64}$/.test(id) ? `e:${id}` : ''
}
