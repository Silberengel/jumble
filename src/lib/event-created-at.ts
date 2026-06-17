import type { Event } from 'nostr-tools'

/** Nostr timelines did not exist before ~2020. */
export const EVENT_CREATED_AT_MIN_SEC = 1_577_836_800

/** Small relay/client clock skew (NIP-01); still rejects far-future spam like year-2100 notes. */
export const EVENT_CREATED_AT_MAX_FUTURE_DRIFT_SEC = 120

export function normalizeEventCreatedAtSec(createdAt: unknown): number | null {
  if (typeof createdAt === 'number' && Number.isFinite(createdAt)) {
    return Math.trunc(createdAt)
  }
  if (typeof createdAt === 'string' && createdAt.trim() !== '') {
    const n = Number(createdAt)
    if (Number.isFinite(n)) return Math.trunc(n)
  }
  return null
}

export function isFutureEventCreatedAt(
  createdAt: unknown,
  nowSec = Math.floor(Date.now() / 1000)
): boolean {
  const t = normalizeEventCreatedAtSec(createdAt)
  if (t === null) return true
  return t > nowSec + EVENT_CREATED_AT_MAX_FUTURE_DRIFT_SEC
}

/** False for nonsense timestamps (far future, pre-Nostr, non-finite). */
export function isPlausibleEventCreatedAt(
  createdAt: unknown,
  nowSec = Math.floor(Date.now() / 1000)
): boolean {
  const t = normalizeEventCreatedAtSec(createdAt)
  if (t === null) return false
  if (t < EVENT_CREATED_AT_MIN_SEC) return false
  if (t > nowSec + EVENT_CREATED_AT_MAX_FUTURE_DRIFT_SEC) return false
  return true
}

/** Sort key for timelines; bogus timestamps sink instead of pinning the feed. */
export function getEventTimelineSortCreatedAt(
  event: Pick<Event, 'created_at'>,
  nowSec = Math.floor(Date.now() / 1000)
): number {
  const t = normalizeEventCreatedAtSec(event.created_at)
  if (t === null || !isPlausibleEventCreatedAt(t, nowSec)) return 0
  return t
}

export function compareEventsNewestFirst(a: Event, b: Event, nowSec = Math.floor(Date.now() / 1000)): number {
  const ta = getEventTimelineSortCreatedAt(a, nowSec)
  const tb = getEventTimelineSortCreatedAt(b, nowSec)
  return tb - ta || b.id.localeCompare(a.id)
}
