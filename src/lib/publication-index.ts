import { ExtendedKind } from '@/constants'
import {
  batchFetchPublicationSectionEvents,
  parsePublicationATagCoordinate,
  type PublicationSectionRef
} from '@/lib/publication-section-fetch'
import type { Event } from 'nostr-tools'
import { verifyEvent } from 'nostr-tools'

/** Normalize kind-30040 rows before signature check (NKBIP-01 empty content; lowercase hex). */
export function publicationIndexForVerify(event: Event): Event {
  return {
    ...event,
    id: event.id.toLowerCase(),
    pubkey: event.pubkey.toLowerCase(),
    content: event.content ?? ''
  }
}

/** True when the event is a kind-30040 index and the signature matches the tag array. */
export function isVerifiedPublicationIndex(event: Event): boolean {
  if (event.kind !== ExtendedKind.PUBLICATION) return false
  return verifyEvent(publicationIndexForVerify(event))
}

export function eventTagAddress(event: Event): string | null {
  const d = event.tags.find((t) => (t[0] || '').trim().toLowerCase() === 'd')?.[1]
  if (!d) return null
  return `${event.kind}:${event.pubkey.toLowerCase()}:${d}`
}

/** NKBIP-01 shape checks only — no signature verification (cheap for large IDB reads).
 *  Sections (`a` / `e`) are optional so catalog-only cards (e.g. Open Library stubs
 *  with a ``summary`` tag and no chapters) remain visible.
 */
export function isStructuralPublicationIndex(event: Event): boolean {
  if (event.kind !== ExtendedKind.PUBLICATION) return false
  if ((event.content ?? '') !== '') return false
  const hasTitle = event.tags.some(
    (t) => (t[0] || '').trim().toLowerCase() === 'title' && t[1]
  )
  const hasD = event.tags.some((t) => (t[0] || '').trim().toLowerCase() === 'd' && t[1])
  return hasTitle && hasD
}

export function filterStructuralIndexEvents(events: Event[]): Event[] {
  return events.filter(isStructuralPublicationIndex)
}

/** Removes kind 30040 index events that don't comply with NKBIP-01 (includes signature check). */
export function filterValidIndexEvents(events: Event[]): Event[] {
  return events.filter(isValidPublicationIndexEvent)
}

export function isValidPublicationIndexEvent(event: Event): boolean {
  return isStructuralPublicationIndex(event) && isVerifiedPublicationIndex(event)
}

/** Canonical library index: `kind:pubkey:d` → newest valid kind-30040 row. */
export type PublicationIndexMap = Map<string, Event>

export function pickNewerPublicationIndexEvent(prev: Event, next: Event): Event {
  if (next.created_at > prev.created_at) return next
  if (next.created_at < prev.created_at) return prev
  return next.id > prev.id ? next : prev
}

/** Upsert by address using NKBIP-01 shape checks only (no signature verify — safe for large IDB reads). */
export function upsertStructuralPublicationIndexMap(map: PublicationIndexMap, event: Event): boolean {
  if (!isStructuralPublicationIndex(event)) return false
  const addr = eventTagAddress(event)
  if (!addr) return false
  const prev = map.get(addr)
  if (!prev) {
    map.set(addr, event)
    return true
  }
  const chosen = pickNewerPublicationIndexEvent(prev, event)
  if (chosen.id === prev.id) return false
  map.set(addr, chosen)
  return true
}

/** Build address map from cached rows without verifyEvent (rows were verified on write). */
export function buildStructuralPublicationIndexMap(events: Iterable<Event>): PublicationIndexMap {
  const map: PublicationIndexMap = new Map()
  for (const event of events) {
    upsertStructuralPublicationIndexMap(map, event)
  }
  return map
}

export function upsertPublicationIndexMap(map: PublicationIndexMap, event: Event): boolean {
  if (!isValidPublicationIndexEvent(event)) return false
  return upsertStructuralPublicationIndexMap(map, event)
}

/** Build the canonical index map from any event list (invalid rows dropped; includes verify). */
export function buildPublicationIndexMap(events: Iterable<Event>): PublicationIndexMap {
  const map: PublicationIndexMap = new Map()
  for (const event of events) {
    upsertPublicationIndexMap(map, event)
  }
  return map
}

/** Merge pre-validated network rows into a map (skips re-verifying signatures). */
export function mergeValidatedPublicationIndexMaps(
  base: PublicationIndexMap,
  incoming: Iterable<Event>
): PublicationIndexMap {
  const out: PublicationIndexMap = new Map(base)
  for (const event of incoming) {
    upsertStructuralPublicationIndexMap(out, event)
  }
  return out
}

export function mergePublicationIndexMaps(
  base: PublicationIndexMap,
  incoming: Iterable<Event>
): PublicationIndexMap {
  return mergeValidatedPublicationIndexMaps(base, incoming)
}

export function publicationIndexMapValues(map: PublicationIndexMap): Event[] {
  return [...map.values()]
}

export function collectPublicationATagRefs(event: Event): PublicationSectionRef[] {
  const refs: PublicationSectionRef[] = []
  for (const tag of event.tags) {
    if (tag[0] !== 'a' || !tag[1]) continue
    const parsed = parsePublicationATagCoordinate(tag[1])
    if (!parsed) continue
    refs.push({
      type: 'a',
      coordinate: parsed.coordinate,
      kind: parsed.kind,
      pubkey: parsed.pubkey,
      identifier: parsed.identifier,
      relay: tag[2]
    })
  }
  return refs
}

export function collectChildAddressesFromIndex(event: Event): string[] {
  const out: string[] = []
  for (const ref of collectPublicationATagRefs(event)) {
    if (
      ref.kind === ExtendedKind.PUBLICATION ||
      ref.kind === ExtendedKind.PUBLICATION_CONTENT
    ) {
      out.push(ref.coordinate!)
    }
  }
  return out
}

export function getReferencedChild30040Addresses(events: Event[]): Set<string> {
  const referenced = new Set<string>()
  for (const event of events) {
    for (const tag of event.tags) {
      if (tag[0] !== 'a' || !tag[1]) continue
      const parts = tag[1].split(':')
      if (parts.length >= 3 && parts[0] === String(ExtendedKind.PUBLICATION)) {
        referenced.add(tag[1])
      }
    }
  }
  return referenced
}

export function getTopLevelIndexEvents(events: Event[]): Event[] {
  const normalized = publicationIndexMapValues(buildStructuralPublicationIndexMap(events))
  const referenced = getReferencedChild30040Addresses(normalized)
  return normalized.filter((event) => {
    const addr = eventTagAddress(event)
    return addr && !referenced.has(addr)
  })
}

export function getTopLevelIndexEventsFromMap(map: PublicationIndexMap): Event[] {
  return getTopLevelIndexEvents(publicationIndexMapValues(map))
}

export function buildIndexByAddress(events: Event[]): Map<string, Event> {
  const map = new Map<string, Event>()
  for (const event of events) {
    const addr = eventTagAddress(event)
    if (!addr) continue
    const prev = map.get(addr)
    if (!prev) {
      map.set(addr, event)
      continue
    }
    map.set(addr, pickNewerPublicationIndexEvent(prev, event))
  }
  return map
}

/** BFS over addresses already present in `indexByAddress` (no network I/O). */
export function collectReachableAddressesCached(
  root: Event,
  indexByAddress: Map<string, Event>
): Set<string> {
  const reachable = new Set<string>()
  const rootAddr = eventTagAddress(root)
  if (!rootAddr) return reachable

  const queue = [rootAddr]
  while (queue.length > 0) {
    const addr = queue.shift()!
    if (reachable.has(addr)) continue
    reachable.add(addr)

    const event = indexByAddress.get(addr)
    if (!event || event.kind !== ExtendedKind.PUBLICATION) continue

    for (const child of collectChildAddressesFromIndex(event)) {
      if (!reachable.has(child)) queue.push(child)
    }
  }

  return reachable
}

export function collectPublicationIndexEventIds(events: Event[]): Set<string> {
  return new Set(events.map((ev) => ev.id.toLowerCase()))
}

export type HydrateNestedIndexOptions = {
  maxPasses?: number
  /** Cap missing nested 30040 fetches per pass (library bulk load). */
  maxMissingPerPass?: number
  /** When set, only scan these roots for missing nested 30040 refs. */
  scanRoots?: Event[]
}

/** Batch-fetch nested kind 30040 indexes referenced by `a` tags but missing from cache. */
export async function hydrateNestedIndexEvents(
  indexByAddress: PublicationIndexMap,
  relayUrls: string[],
  options?: HydrateNestedIndexOptions | number
): Promise<void> {
  const opts: HydrateNestedIndexOptions =
    typeof options === 'number' ? { maxPasses: options } : (options ?? {})
  const maxPasses = opts.maxPasses ?? 2
  const maxMissingPerPass = opts.maxMissingPerPass
  const scanEvents = opts.scanRoots ?? publicationIndexMapValues(indexByAddress)

  for (let pass = 0; pass < maxPasses; pass++) {
    const missingRefs: PublicationSectionRef[] = []
    const seenCoords = new Set<string>()
    for (const event of scanEvents) {
      if (event.kind !== ExtendedKind.PUBLICATION) continue
      for (const ref of collectPublicationATagRefs(event)) {
        if (ref.kind !== ExtendedKind.PUBLICATION || !ref.coordinate) continue
        if (indexByAddress.has(ref.coordinate) || seenCoords.has(ref.coordinate)) continue
        seenCoords.add(ref.coordinate)
        missingRefs.push(ref)
        if (maxMissingPerPass != null && missingRefs.length >= maxMissingPerPass) break
      }
      if (maxMissingPerPass != null && missingRefs.length >= maxMissingPerPass) break
    }
    if (missingRefs.length === 0) break
    const fetched = await batchFetchPublicationSectionEvents(missingRefs, relayUrls)
    let added = 0
    for (const ev of fetched.values()) {
      if (upsertPublicationIndexMap(indexByAddress, ev)) added++
    }
    if (added === 0) break
  }
}

export async function collectReachableAddresses(
  root: Event,
  indexByAddress: Map<string, Event>,
  fetchMissingIndex: (address: string) => Promise<Event | null>
): Promise<Set<string>> {
  const reachable = new Set<string>()
  const rootAddr = eventTagAddress(root)
  if (!rootAddr) return reachable

  const queue = [rootAddr]
  while (queue.length > 0) {
    const addr = queue.shift()!
    if (reachable.has(addr)) continue
    reachable.add(addr)

    let event = indexByAddress.get(addr)
    if (!event) {
      const parsed = parsePublicationATagCoordinate(addr)
      if (parsed?.kind === ExtendedKind.PUBLICATION) {
        event = (await fetchMissingIndex(addr)) ?? undefined
        if (event) indexByAddress.set(addr, event)
      }
    }
    if (!event || event.kind !== ExtendedKind.PUBLICATION) continue

    for (const child of collectChildAddressesFromIndex(event)) {
      if (!reachable.has(child)) queue.push(child)
    }
  }

  return reachable
}

export async function fetchMissingIndexByAddress(
  address: string,
  relayUrls: string[]
): Promise<Event | null> {
  const parsed = parsePublicationATagCoordinate(address)
  if (!parsed || parsed.kind !== ExtendedKind.PUBLICATION) return null
  const ref: PublicationSectionRef = {
    type: 'a',
    coordinate: parsed.coordinate,
    kind: parsed.kind,
    pubkey: parsed.pubkey,
    identifier: parsed.identifier
  }
  const fetched = await batchFetchPublicationSectionEvents([ref], relayUrls)
  return fetched.get(parsed.coordinate) ?? null
}
