import { ExtendedKind } from '@/constants'
import { getRelayUrlFromRelayReviewEvent } from '@/lib/event-metadata'
import type { Event as NEvent } from 'nostr-tools'
import { kinds } from 'nostr-tools'

/**
 * Detects **kind-1 note** spam where `content` is a stringified JSON **object** (game/app payloads, etc.)
 * instead of human-readable text. Scoped to {@link kinds.ShortTextNote} only.
 */
function isStringifiedJsonObjectContentNostrEvent(
  event: Pick<NEvent, 'kind' | 'content'>
): boolean {
  if (event.kind !== kinds.ShortTextNote) return false

  const c = typeof event.content === 'string' ? event.content.trim() : ''
  if (c.length < 2 || c[0] !== '{' || c[c.length - 1] !== '}') return false
  try {
    const v = JSON.parse(c) as unknown
    return v !== null && typeof v === 'object' && !Array.isArray(v)
  } catch {
    return false
  }
}

/**
 * Kind-31987 noise: missing `d` (relay URL). Rating formats differ across clients; do not drop at ingest
 * (feeds and cards already treat unknown ratings as zero stars).
 */
function isIncompleteRelayReviewIngest(event: NEvent): boolean {
  if (event.kind !== ExtendedKind.RELAY_REVIEW) return false
  return !getRelayUrlFromRelayReviewEvent(event)
}

/**
 * Kacti-style kind-1 “broadcast” payloads (non-human notes that flood index relays). Not valid Nostr discussion text.
 * Dropped from timelines, search, and prefetch; still loadable when the user opens that exact id (hex / note1 / nevent).
 */
function isKactiBroadcastSpamKind1(event: Pick<NEvent, 'kind' | 'content'>): boolean {
  if (event.kind !== kinds.ShortTextNote) return false
  const c = typeof event.content === 'string' ? event.content.trimStart() : ''
  return c.startsWith('[broadcast:[#')
}

export type ShouldDropEventOnIngestOptions = {
  /**
   * When set to the same 64-char hex as {@link NEvent.id} (lowercase), {@link isKactiBroadcastSpamKind1} does not apply
   * so `fetchEvent` / direct note views can still show the payload.
   */
  explicitNoteLookupHexId?: string
}

function explicitLookupMatchesEvent(eventId: string, lookup?: string): boolean {
  if (!lookup) return false
  const l = lookup.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(l)) return false
  return eventId.toLowerCase() === l
}

/** NIP-71 addressable short video — dropped site-wide (relay spam). */
const DEPRECATED_NIP71_SHORT_VIDEO_ADDRESSABLE_KIND = 34236

/**
 * Single gate for subscribe/cache/IDB read paths: drop kind-1 JSON-object spam, Kacti broadcast spam,
 * and malformed relay reviews. Optional {@link ShouldDropEventOnIngestOptions} relaxes Kacti drops for explicit id fetch.
 */
export function shouldDropEventOnIngest(
  event: NEvent,
  options?: ShouldDropEventOnIngestOptions
): boolean {
  if (event.kind === DEPRECATED_NIP71_SHORT_VIDEO_ADDRESSABLE_KIND) return true
  if (isIncompleteRelayReviewIngest(event)) return true
  if (isStringifiedJsonObjectContentNostrEvent(event)) return true
  if (isKactiBroadcastSpamKind1(event)) {
    if (explicitLookupMatchesEvent(event.id, options?.explicitNoteLookupHexId)) return false
    return true
  }
  return false
}
