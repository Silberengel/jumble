import type { Event } from 'nostr-tools'

/** NIP-33 addressable coordinate key (`pubkey:kind:d`) when `d` is present. */
export function getAddressableDedupeKey(event: Pick<Event, 'kind' | 'pubkey' | 'tags'>): string | null {
  if (event.kind < 30000 || event.kind >= 40000) return null
  const d = event.tags.find((t) => t[0] === 'd')?.[1]?.trim()
  if (!d) return null
  return `${event.pubkey}:${event.kind}:${d}`
}

/** Positive when `a` is a newer replaceable revision than `b`. */
export function compareReplaceableRevision(a: Event, b: Event): number {
  if (a.created_at !== b.created_at) return a.created_at - b.created_at
  return a.id.localeCompare(b.id)
}

export function pickNewestReplaceableRevision(candidates: readonly Event[]): Event | undefined {
  if (!candidates.length) return undefined
  return candidates.reduce((best, e) => (compareReplaceableRevision(e, best) > 0 ? e : best))
}

/** One row per `pubkey:kind:d`; keeps the newest revision only. */
export function dedupeLatestAddressableEvents(events: readonly Event[]): Event[] {
  const latestByKey = new Map<string, Event>()
  const nonAddressable: Event[] = []
  for (const evt of events) {
    const key = getAddressableDedupeKey(evt)
    if (!key) {
      nonAddressable.push(evt)
      continue
    }
    const existing = latestByKey.get(key)
    if (!existing || compareReplaceableRevision(evt, existing) > 0) {
      latestByKey.set(key, evt)
    }
  }
  return [...nonAddressable, ...latestByKey.values()]
}

/**
 * Remove superseded addressable revisions from a timeline batch (feeds, thread replies).
 * Non-addressable rows are unchanged.
 */
export function collapseStaleAddressableRevisions(events: readonly Event[]): Event[] {
  const latestByKey = new Map<string, Event>()
  for (const evt of events) {
    const key = getAddressableDedupeKey(evt)
    if (!key) continue
    const existing = latestByKey.get(key)
    if (!existing || compareReplaceableRevision(evt, existing) > 0) {
      latestByKey.set(key, evt)
    }
  }
  if (latestByKey.size === 0) return [...events]

  const winningIds = new Set<string>()
  for (const winner of latestByKey.values()) {
    winningIds.add(winner.id)
  }
  return events.filter((evt) => {
    const key = getAddressableDedupeKey(evt)
    if (!key) return true
    return winningIds.has(evt.id)
  })
}

/** When merging into a by-id map, supersede older addressable revisions (same `pubkey:kind:d`). */
export function upsertEventMapPreferNewestAddressable(byId: Map<string, Event>, evt: Event): void {
  const key = getAddressableDedupeKey(evt)
  if (!key) {
    byId.set(evt.id, evt)
    return
  }
  for (const [id, existing] of byId) {
    if (getAddressableDedupeKey(existing) !== key) continue
    if (compareReplaceableRevision(evt, existing) > 0) {
      byId.delete(id)
      byId.set(evt.id, evt)
    }
    return
  }
  byId.set(evt.id, evt)
}
