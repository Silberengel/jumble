import { compareEventsNewestFirst } from '@/lib/event-created-at'
import type { Event } from 'nostr-tools'

export function mergeEventsById(
  existing: readonly Event[],
  incoming: readonly Event[],
  cap: number
): Event[] {
  const byId = new Map<string, Event>()
  for (const e of existing) byId.set(e.id, e)
  for (const e of incoming) {
    const prev = byId.get(e.id)
    if (!prev || e.created_at >= prev.created_at) byId.set(e.id, e)
  }
  return [...byId.values()].sort(compareEventsNewestFirst).slice(0, cap)
}
