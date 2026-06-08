import { ExtendedKind } from '@/constants'
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
