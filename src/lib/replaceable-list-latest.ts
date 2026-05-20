import { ExtendedKind, METADATA_BATCH_QUERY_EOSE_TIMEOUT_MS, METADATA_BATCH_QUERY_GLOBAL_TIMEOUT_MS } from '@/constants'
import { networkKindsForReplaceableFetch } from '@/lib/replaceable-fetch-kinds'
import { normalizeHexPubkey } from '@/lib/pubkey'
import { normalizeAnyRelayUrl } from '@/lib/url'
import client, { eventService } from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import type { TPersonalListBech32Ref } from '@/lib/personal-list-mutations'
import { kinds, type Event } from 'nostr-tools'

function isSlowReplaceableListKind(kind: number): boolean {
  return (
    kind === kinds.Metadata ||
    kind === 10001 ||
    kind === ExtendedKind.PAYMENT_INFO ||
    kind === kinds.Contacts ||
    kind === kinds.RelayList ||
    kind === kinds.Mutelist ||
    kind === kinds.BookmarkList ||
    kind === ExtendedKind.PROFILE_BADGES_LIST
  )
}

function replaceableListFetchQueryOpts(kind: number) {
  const slow = isSlowReplaceableListKind(kind)
  return {
    replaceableRace: !slow,
    eoseTimeout: slow ? METADATA_BATCH_QUERY_EOSE_TIMEOUT_MS : 100,
    globalTimeout: slow ? METADATA_BATCH_QUERY_GLOBAL_TIMEOUT_MS : 2000
  }
}

function newestReplaceableEvent(candidates: Event[]): Event | undefined {
  if (!candidates.length) return undefined
  return candidates.reduce((best, e) => (e.created_at > best.created_at ? e : best))
}

/**
 * REQ across relays, then keep the newest `created_at` row for this author+kind.
 * Slow replaceables (pins, contacts, …) wait for EOSE instead of {@link replaceableRace} so mirrors aren’t missed.
 */
export async function fetchLatestReplaceableListEvent(
  pubkeyHex: string,
  kind: number,
  relayUrls: string[]
): Promise<Event | undefined> {
  const pk = normalizeHexPubkey(pubkeyHex)
  const allUrls = [...new Set(relayUrls.map((u) => normalizeAnyRelayUrl(u) || u).filter(Boolean))]
  if (!allUrls.length) return undefined

  const rows = await client.fetchEvents(
    allUrls,
    { authors: [pk], kinds: networkKindsForReplaceableFetch(kind), limit: 80 },
    replaceableListFetchQueryOpts(kind)
  )

  return newestReplaceableEvent(rows.filter((e) => e.kind === kind))
}

/**
 * Kind 10001 from browsing relays can be stale vs the copy resolved via the author’s relay set
 * ({@link client.fetchPinListEvent}). Merge both and keep the newest `created_at` so pin UI and merges
 * match the profile pin list.
 */
export async function fetchNewestPinListForPubkey(
  pubkeyHex: string,
  relayUrls: string[]
): Promise<Event | undefined> {
  const pk = normalizeHexPubkey(pubkeyHex)
  const diskPin = await indexedDb.getReplaceableEvent(pk, 10001).catch(() => undefined)
  const sessionPins = eventService.listSessionEventsAuthoredBy(pk, { kinds: [10001], limit: 8 })
  const [fromRelays, fromService] = await Promise.all([
    relayUrls.length
      ? fetchLatestReplaceableListEvent(pk, 10001, relayUrls)
      : Promise.resolve(undefined),
    client.fetchPinListEvent(pk).catch(() => undefined)
  ])
  return newestReplaceableEvent(
    [fromRelays, fromService, diskPin, ...sessionPins].filter((e): e is Event => !!e)
  )
}

/** Whether this event is referenced by the pin list via `e` (hex id) or `a` (NIP-33 coordinate). */
export function isEventInPinList(pinList: Event, event: Event): boolean {
  const idLower = event.id.toLowerCase()
  const d = event.tags.find((t) => t[0] === 'd')?.[1] ?? ''
  const coord = `${event.kind}:${event.pubkey}:${d}`.toLowerCase()
  for (const tag of pinList.tags) {
    if (tag[0] === 'e' && tag[1] && tag[1].toLowerCase() === idLower) return true
    if (tag[0] === 'a' && tag[1] && tag[1].toLowerCase() === coord) return true
  }
  return false
}

function orderedUniqueEHexIds(tags: string[][]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tags) {
    if (t[0] === 'e' && t[1] && /^[0-9a-f]{64}$/i.test(t[1])) {
      const id = t[1].toLowerCase()
      if (!seen.has(id)) {
        seen.add(id)
        out.push(id)
      }
    }
  }
  return out
}

/**
 * Next pin list (kind 10001) tags: preserve non-`e`/`a` tags and `a` pins, merge `e` hex ids with dedupe.
 * Unpin removes both the `e` id and an `a` coordinate when the list used NIP-33 pins.
 */
export function buildPinListTagsAfterToggle(
  latest: Event | null | undefined,
  targetEvent: Event,
  shouldPin: boolean
): string[][] {
  const tags = latest?.tags ?? []
  const meta = tags.filter((t) => t[0] !== 'e' && t[0] !== 'a')
  const d = targetEvent.tags.find((t) => t[0] === 'd')?.[1] ?? ''
  const coord = `${targetEvent.kind}:${targetEvent.pubkey}:${d}`.toLowerCase()
  let aKeep = tags.filter((t) => t[0] === 'a' && t[1])
  if (!shouldPin) {
    aKeep = aKeep.filter((t) => t[1]!.toLowerCase() !== coord)
  }
  let eIds = orderedUniqueEHexIds(tags)
  const id = targetEvent.id.toLowerCase()
  if (shouldPin) {
    if (!eIds.includes(id)) eIds = [...eIds, id]
  } else {
    eIds = eIds.filter((x) => x !== id)
  }
  return [...meta, ...aKeep, ...eIds.map((eid) => ['e', eid] as string[])]
}

/**
 * Pin list tags after removing an entry identified only by nevent/note id and/or naddr coordinate
 * (when the pinned event is not loaded). Returns null if nothing matched.
 */
export function buildPinListTagsAfterRemovingRef(
  tags: string[][],
  ref: TPersonalListBech32Ref
): string[][] | null {
  if (!ref.eIdLower && !ref.aCoordLower) return null
  const meta = tags.filter((t) => t[0] !== 'e' && t[0] !== 'a')
  let aKeep = tags.filter((t) => t[0] === 'a' && t[1])
  const origALen = aKeep.length
  if (ref.aCoordLower) {
    aKeep = aKeep.filter((t) => t[1]!.toLowerCase() !== ref.aCoordLower)
  }
  let eIds = orderedUniqueEHexIds(tags)
  const origELen = eIds.length
  if (ref.eIdLower) {
    eIds = eIds.filter((x) => x !== ref.eIdLower)
  }
  if (aKeep.length === origALen && eIds.length === origELen) return null
  return [...meta, ...aKeep, ...eIds.map((eid) => ['e', eid] as string[])]
}

/** Dedupe `p` tags (case-insensitive hex), preserve other tags and first-seen `p` casing. */
function dedupePTags(tags: string[][]): string[][] {
  const nonP = tags.filter((t) => t[0] !== 'p')
  const seen = new Set<string>()
  const pOut: string[][] = []
  for (const t of tags) {
    if (t[0] === 'p' && t[1]) {
      const k = t[1].toLowerCase()
      if (!seen.has(k)) {
        seen.add(k)
        pOut.push(['p', t[1]])
      }
    }
  }
  return [...nonP, ...pOut]
}

/** Append `p` pubkey if missing; dedupe all `p` tags. */
export function dedupePTagsAppendPubkey(tags: string[][], pubkey: string): string[][] {
  const pk = pubkey.toLowerCase()
  const nonP = tags.filter((t) => t[0] !== 'p')
  const seen = new Set<string>()
  const pOut: string[][] = []
  for (const t of tags) {
    if (t[0] === 'p' && t[1]) {
      const k = t[1].toLowerCase()
      if (!seen.has(k)) {
        seen.add(k)
        pOut.push(['p', t[1]])
      }
    }
  }
  if (!seen.has(pk)) {
    pOut.push(['p', pubkey])
  }
  return [...nonP, ...pOut]
}

/** Remove every `p` tag matching pubkey (case-insensitive); dedupe remaining `p` tags. */
export function removePubkeyFromPTags(tags: string[][], pubkey: string): string[][] {
  const pk = pubkey.toLowerCase()
  const filtered = tags.filter((t) => !(t[0] === 'p' && t[1]?.toLowerCase() === pk))
  return dedupePTags(filtered)
}
