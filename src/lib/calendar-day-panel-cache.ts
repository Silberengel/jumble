import type { Event } from 'nostr-tools'

const KEY_PREFIX = 'jumble:calendarDayPanel:'

/** Persist calendar events for a day so the secondary panel can load them without a giant URL. */
export function setCalendarDayPanelEvents(ymd: string, events: Event[]): void {
  try {
    sessionStorage.setItem(KEY_PREFIX + ymd, JSON.stringify(events))
  } catch {
    /* quota or private mode */
  }
}

export function readCalendarDayPanelEvents(ymd: string): Event[] | null {
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + ymd)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed.filter((x): x is Event => x && typeof x === 'object' && typeof (x as Event).id === 'string')
  } catch {
    return null
  }
}
