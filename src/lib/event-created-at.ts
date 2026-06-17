import type { Event } from 'nostr-tools'

/** Nostr timelines did not exist before ~2020. */
export const EVENT_CREATED_AT_MIN_SEC = 1_577_836_800

export function isFutureEventCreatedAt(
  createdAt: number,
  nowSec = Math.floor(Date.now() / 1000)
): boolean {
  if (!Number.isFinite(createdAt)) return true
  return Math.trunc(createdAt) > nowSec
}

/** False for nonsense timestamps (future, pre-Nostr, non-finite). */
export function isPlausibleEventCreatedAt(
  createdAt: number,
  nowSec = Math.floor(Date.now() / 1000)
): boolean {
  if (!Number.isFinite(createdAt)) return false
  const t = Math.trunc(createdAt)
  if (t < EVENT_CREATED_AT_MIN_SEC) return false
  if (t > nowSec) return false
  return true
}

/** Sort key for timelines; bogus timestamps sink instead of pinning the feed. */
export function getEventTimelineSortCreatedAt(
  event: Pick<Event, 'created_at'>,
  nowSec = Math.floor(Date.now() / 1000)
): number {
  const t = Math.trunc(event.created_at)
  return isPlausibleEventCreatedAt(t, nowSec) ? t : 0
}

export function compareEventsNewestFirst(a: Event, b: Event, nowSec = Math.floor(Date.now() / 1000)): number {
  const ta = getEventTimelineSortCreatedAt(a, nowSec)
  const tb = getEventTimelineSortCreatedAt(b, nowSec)
  return tb - ta || b.id.localeCompare(a.id)
}
