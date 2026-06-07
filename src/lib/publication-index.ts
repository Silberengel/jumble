import { ExtendedKind } from '@/constants'
import {
  batchFetchPublicationSectionEvents,
  parsePublicationATagCoordinate,
  type PublicationSectionRef
} from '@/lib/publication-section-fetch'
import type { Event } from 'nostr-tools'

export function eventTagAddress(event: Event): string | null {
  const d = event.tags.find((t) => (t[0] || '').trim().toLowerCase() === 'd')?.[1]
  if (!d) return null
  return `${event.kind}:${event.pubkey.toLowerCase()}:${d}`
}

/** Removes kind 30040 index events that don't comply with NKBIP-01. */
export function filterValidIndexEvents(events: Event[]): Event[] {
  return events.filter((event) => {
    if (event.kind !== ExtendedKind.PUBLICATION) return false
    if (event.content != null && event.content.length > 0) return false
    const hasTitle = event.tags.some((t) => t[0] === 'title' && t[1])
    const hasD = event.tags.some((t) => t[0] === 'd' && t[1])
    const hasA = event.tags.some((t) => t[0] === 'a' && t[1])
    const hasE = event.tags.some((t) => t[0] === 'e' && t[1])
    return hasTitle && hasD && (hasA || hasE)
  })
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
  const referenced = getReferencedChild30040Addresses(events)
  return events.filter((event) => {
    const addr = eventTagAddress(event)
    return addr && !referenced.has(addr)
  })
}

export function buildIndexByAddress(events: Event[]): Map<string, Event> {
  const map = new Map<string, Event>()
  for (const event of events) {
    const addr = eventTagAddress(event)
    if (!addr) continue
    const prev = map.get(addr)
    if (!prev || event.created_at > prev.created_at) {
      map.set(addr, event)
    }
  }
  return map
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
