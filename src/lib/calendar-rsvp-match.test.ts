import { describe, expect, it } from 'vitest'
import { ExtendedKind } from '@/constants'
import {
  calendarEventHexId,
  calendarRsvpMatchesCalendarEvent,
  calendarRsvpParentKeyFromEventId,
  parseCalendarRsvpStatus
} from '@/lib/calendar-rsvp-match'
import type { Event } from 'nostr-tools'

const ORG = 'b'.repeat(63) + 'c'
const D = 'purple-prague'
const CAL_ID = 'a'.repeat(64)

function calendarEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: CAL_ID,
    pubkey: ORG,
    created_at: 1_700_000_000,
    kind: ExtendedKind.CALENDAR_EVENT_TIME,
    tags: [['d', D]],
    content: '',
    sig: 'sig',
    ...overrides
  }
}

function rsvp(tags: string[][], pubkey = 'c'.repeat(63) + 'd'): Event {
  return {
    id: 'f'.repeat(64),
    pubkey,
    created_at: 1_700_000_100,
    kind: ExtendedKind.CALENDAR_EVENT_RSVP,
    tags,
    content: '',
    sig: 'sig'
  }
}

describe('calendarRsvpMatchesCalendarEvent', () => {
  const cal = calendarEvent()
  const coord = `${ExtendedKind.CALENDAR_EVENT_TIME}:${ORG}:${D}`

  it('matches via normalized a tag', () => {
    expect(
      calendarRsvpMatchesCalendarEvent(
        cal,
        rsvp([
          ['a', coord],
          ['status', 'accepted']
        ])
      )
    ).toBe(true)
  })

  it('matches via e tag when a is absent', () => {
    expect(
      calendarRsvpMatchesCalendarEvent(
        cal,
        rsvp([
          ['e', CAL_ID.toUpperCase()],
          ['status', 'tentative']
        ])
      )
    ).toBe(true)
  })

  it('rejects wrong coordinate and wrong event id', () => {
    expect(
      calendarRsvpMatchesCalendarEvent(
        cal,
        rsvp([
          ['a', `${ExtendedKind.CALENDAR_EVENT_TIME}:${ORG}:other`],
          ['e', 'b'.repeat(64)]
        ])
      )
    ).toBe(false)
  })
})

describe('parseCalendarRsvpStatus', () => {
  it('parses accepted, tentative, declined', () => {
    expect(parseCalendarRsvpStatus(rsvp([['status', 'Accepted']]))).toBe('accepted')
    expect(parseCalendarRsvpStatus(rsvp([['status', 'TENTATIVE']]))).toBe('tentative')
    expect(parseCalendarRsvpStatus(rsvp([['status', 'declined']]))).toBe('declined')
  })

  it('returns undefined for missing or invalid status', () => {
    expect(parseCalendarRsvpStatus(rsvp([]))).toBeUndefined()
    expect(parseCalendarRsvpStatus(rsvp([['status', 'maybe']]))).toBeUndefined()
  })
})

describe('calendarEventHexId', () => {
  it('lowercases 64-char hex ids', () => {
    expect(calendarEventHexId({ ...calendarEvent(), id: CAL_ID.toUpperCase() })).toBe(CAL_ID)
  })
})

describe('calendarRsvpParentKeyFromEventId', () => {
  it('builds e: prefix key', () => {
    expect(calendarRsvpParentKeyFromEventId(CAL_ID)).toBe(`e:${CAL_ID}`)
    expect(calendarRsvpParentKeyFromEventId('not-hex')).toBe('')
  })
})
