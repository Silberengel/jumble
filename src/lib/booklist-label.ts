import { ExtendedKind } from '@/constants'
import { eventTagAddress } from '@/lib/publication-index'
import {
  labelEventHasBooklistTag,
  NIP32_BOOKLIST_LABEL
} from '@/lib/nip32-label'
import client, { eventService } from '@/services/client.service'
import type { Event, Filter } from 'nostr-tools'

export const BOOKLIST_LABEL_UPDATED_EVENT = 'booklist-label-updated'

export type ViewerBooklistTargets = {
  addresses: Set<string>
  eventIds: Set<string>
}

function collectBooklistTargetsFromLabelEvents(events: Event[]): ViewerBooklistTargets {
  const addresses = new Set<string>()
  const eventIds = new Set<string>()
  for (const ev of events) {
    if (!labelEventHasBooklistTag(ev)) continue
    for (const tag of ev.tags) {
      if (tag[0] === 'a' && tag[1]?.trim()) addresses.add(tag[1].trim())
      if (tag[0] === 'e' && tag[1]?.trim()) eventIds.add(tag[1].trim().toLowerCase())
    }
  }
  return { addresses, eventIds }
}

/** All publication coordinates the viewer has on their booklist (session + network). */
export async function fetchViewerBooklistTargets(
  userPubkey: string,
  relayUrls: string[]
): Promise<ViewerBooklistTargets> {
  const sessionHits = eventService.listSessionEventsAuthoredBy(userPubkey, {
    kinds: [ExtendedKind.LABEL],
    limit: 200
  })
  const merged = new Map<string, Event>()
  for (const ev of sessionHits) {
    if (labelEventHasBooklistTag(ev)) merged.set(ev.id, ev)
  }

  if (relayUrls.length > 0) {
    const filter: Filter = {
      kinds: [ExtendedKind.LABEL],
      authors: [userPubkey],
      '#l': [NIP32_BOOKLIST_LABEL],
      limit: 500
    }
    const network = await client.fetchEvents(relayUrls, [filter], {
      globalTimeout: 12_000,
      eoseTimeout: 3_000
    })
    for (const ev of network) {
      if (labelEventHasBooklistTag(ev)) merged.set(ev.id, ev)
    }
  }

  return collectBooklistTargetsFromLabelEvents([...merged.values()])
}

export function dispatchBooklistLabelUpdated(publication: Event): void {
  window.dispatchEvent(
    new CustomEvent(BOOKLIST_LABEL_UPDATED_EVENT, {
      detail: { publicationId: publication.id, address: eventTagAddress(publication) }
    })
  )
}

export function booklistLabelTargetsPublication(labelEvent: Event, publication: Event): boolean {
  if (labelEvent.kind !== ExtendedKind.LABEL || !labelEventHasBooklistTag(labelEvent)) return false
  const address = eventTagAddress(publication)
  if (!address) return false
  for (const tag of labelEvent.tags) {
    if (tag[0] === 'a' && tag[1] === address) return true
    if (tag[0] === 'e' && tag[1]?.toLowerCase() === publication.id.toLowerCase()) return true
  }
  return false
}

function newestMatchingLabel(events: Event[], publication: Event): Event | null {
  return (
    events
      .filter((ev) => booklistLabelTargetsPublication(ev, publication))
      .sort((a, b) => b.created_at - a.created_at)[0] ?? null
  )
}

export function findSessionBooklistLabelForPublication(
  userPubkey: string,
  publication: Event
): Event | null {
  const sessionHits = eventService.listSessionEventsAuthoredBy(userPubkey, {
    kinds: [ExtendedKind.LABEL],
    limit: 48
  })
  return newestMatchingLabel(sessionHits, publication)
}

export async function fetchUserBooklistLabelForPublication(
  userPubkey: string,
  publication: Event,
  relayUrls: string[]
): Promise<Event | null> {
  const session = findSessionBooklistLabelForPublication(userPubkey, publication)
  if (session) return session

  const address = eventTagAddress(publication)
  if (!address || relayUrls.length === 0) return null

  const filter: Filter = {
    kinds: [ExtendedKind.LABEL],
    authors: [userPubkey],
    '#l': [NIP32_BOOKLIST_LABEL],
    '#a': [address],
    limit: 8
  }

  const network = await client.fetchEvents(relayUrls, [filter], {
    globalTimeout: 10_000,
    eoseTimeout: 2_500
  })
  return newestMatchingLabel(network, publication)
}
