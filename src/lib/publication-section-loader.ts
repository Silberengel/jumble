import { ExtendedKind } from '@/constants'
import { eventTagAddress } from '@/lib/publication-index'
import { orderedPublicationRefsFromIndex } from '@/lib/publication-asciidoc-assembler'
import {
  batchFetchPublicationSectionEvents,
  buildPublicationSectionRelayUrls,
  publicationRefKey,
  type PublicationSectionRef
} from '@/lib/publication-section-fetch'
import type { Event } from 'nostr-tools'

export type PublicationSectionLoadTask = {
  ref: PublicationSectionRef
  indexEvent: Event
}

function isPublicationBranchRef(ref: PublicationSectionRef): boolean {
  if (ref.type !== 'a' || !ref.coordinate) return false
  const kind = ref.kind ?? parseInt(ref.coordinate.split(':')[0], 10)
  return kind === ExtendedKind.PUBLICATION
}

/** Depth-first list of section refs that still need a network/cache fetch. */
export function collectPendingPublicationSectionLoads(
  rootIndex: Event,
  fetched: ReadonlyMap<string, Event>,
  failed: ReadonlySet<string>,
  inFlight: ReadonlySet<string>
): PublicationSectionLoadTask[] {
  const out: PublicationSectionLoadTask[] = []

  function walk(indexEvent: Event): void {
    for (const ref of orderedPublicationRefsFromIndex(indexEvent)) {
      const key = publicationRefKey(ref)
      if (!key || failed.has(key)) continue
      if (!fetched.has(key) && !inFlight.has(key)) {
        out.push({ ref, indexEvent })
        continue
      }
      const ev = fetched.get(key)
      if (ev && isPublicationBranchRef(ref) && ev.kind === ExtendedKind.PUBLICATION) {
        walk(ev)
      }
    }
  }

  walk(rootIndex)
  return out
}

/** Count loaded/failed vs still-pending section refs (for loading progress UI). */
export function countPublicationSectionLoadProgress(
  rootIndex: Event,
  fetched: ReadonlyMap<string, Event>,
  failed: ReadonlySet<string>
): { resolved: number; pending: number } {
  let resolved = 0
  let pending = 0

  function walk(indexEvent: Event): void {
    for (const ref of orderedPublicationRefsFromIndex(indexEvent)) {
      const key = publicationRefKey(ref)
      if (!key) continue
      if (failed.has(key) || fetched.has(key)) resolved++
      else pending++

      const ev = fetched.get(key)
      if (ev && isPublicationBranchRef(ref) && ev.kind === ExtendedKind.PUBLICATION) {
        walk(ev)
      }
    }
  }

  walk(rootIndex)
  return { resolved, pending }
}

function addressFromFetchedRef(
  ref: PublicationSectionRef,
  fetched: ReadonlyMap<string, Event>
): string | undefined {
  const coord = ref.coordinate?.trim().toLowerCase()
  if (coord) return coord
  const key = publicationRefKey(ref)
  const ev = key ? fetched.get(key) : undefined
  return ev ? eventTagAddress(ev)?.toLowerCase() : undefined
}

/** Loads along the tree path until {@code targetAddress} is reachable (inclusive). */
export function collectPublicationSectionLoadsForAddress(
  rootIndex: Event,
  fetched: ReadonlyMap<string, Event>,
  failed: ReadonlySet<string>,
  inFlight: ReadonlySet<string>,
  targetAddress: string
): PublicationSectionLoadTask[] {
  const target = targetAddress.trim().toLowerCase()
  const tasks: PublicationSectionLoadTask[] = []

  function walk(indexEvent: Event): boolean {
    for (const ref of orderedPublicationRefsFromIndex(indexEvent)) {
      const key = publicationRefKey(ref)
      if (!key || failed.has(key)) continue

      const refAddress = addressFromFetchedRef(ref, fetched)
      const isTarget = refAddress === target

      if (!fetched.has(key) && !inFlight.has(key)) {
        tasks.push({ ref, indexEvent })
      }

      if (isTarget) return true

      const ev = fetched.get(key)
      if (ev && isPublicationBranchRef(ref) && ev.kind === ExtendedKind.PUBLICATION) {
        if (walk(ev)) return true
      }
    }
    return false
  }

  walk(rootIndex)
  return tasks
}

export function fetchedPublicationEventForAddress(
  fetched: ReadonlyMap<string, Event>,
  targetAddress: string
): Event | undefined {
  const target = targetAddress.trim().toLowerCase()
  const direct = fetched.get(target)
  if (direct) return direct
  for (const ev of fetched.values()) {
    if (eventTagAddress(ev)?.toLowerCase() === target) return ev
  }
  return undefined
}

export async function fetchPublicationSection(
  ref: PublicationSectionRef,
  indexEvent: Event,
  relayUrls: string[]
): Promise<Event | null> {
  const key = publicationRefKey(ref)
  if (!key) return null

  const primaryRelays = await buildPublicationSectionRelayUrls(indexEvent, [ref], 40, false)
  const mergedPrimary = [...new Set([...primaryRelays, ...relayUrls])]
  let resolved = await batchFetchPublicationSectionEvents([ref], mergedPrimary)
  let ev = resolved.get(key) ?? null

  if (!ev && ref.type === 'a') {
    const fallbackRelays = await buildPublicationSectionRelayUrls(indexEvent, [ref], 80, true)
    const mergedFallback = [...new Set([...fallbackRelays, ...relayUrls])]
    resolved = await batchFetchPublicationSectionEvents([ref], mergedFallback)
    ev = resolved.get(key) ?? null
  }

  return ev
}
