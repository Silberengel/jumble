import { ExtendedKind } from '@/constants'
import { isPlausibleEventCreatedAt } from '@/lib/event-created-at'
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

/**
 * drift.gits.net kind-1 payloads (`sp_<id>.….drift.gits.net` + `t` tag) — relay index noise, not discussion text.
 */
/** Min length for kind-1 opaque blobs (base64-like relay noise). */
const OPAQUE_BLOB_KIND1_MIN_LEN = 80
/** Min length when there is no `=` padding but the whole note is still one opaque token. */
const OPAQUE_BLOB_KIND1_MIN_LEN_NO_PAD = 120

/**
 * Long single-token payloads (usually base64) with no readable text — relay index spam.
 */
function isLongOpaqueRandomStringKind1(event: Pick<NEvent, 'kind' | 'content'>): boolean {
  if (event.kind !== kinds.ShortTextNote) return false
  const raw = typeof event.content === 'string' ? event.content : ''
  const compact = raw.trim().replace(/\s+/g, '')
  if (compact.length < OPAQUE_BLOB_KIND1_MIN_LEN) return false
  if (!/^[A-Za-z0-9+/]+=*$/.test(compact)) return false
  const bodyLen = compact.replace(/=+$/, '').length
  if (compact.endsWith('=')) {
    return bodyLen >= OPAQUE_BLOB_KIND1_MIN_LEN - 4
  }
  return compact.length >= OPAQUE_BLOB_KIND1_MIN_LEN_NO_PAD
}

function isDriftGitsNetSpamKind1(
  event: Pick<NEvent, 'kind' | 'content' | 'tags'>
): boolean {
  if (event.kind !== kinds.ShortTextNote) return false
  const c = typeof event.content === 'string' ? event.content.trim() : ''
  if (/\.drift\.gits\.net$/i.test(c) || /^sp_[0-9a-f]+\./i.test(c)) return true
  for (const tag of event.tags) {
    if (tag[0] === 't' && typeof tag[1] === 'string' && /^sp_[0-9a-f]+$/i.test(tag[1].trim())) {
      return true
    }
  }
  return false
}

export type ShouldDropEventOnIngestOptions = {
  /**
   * When set to the same 64-char hex as {@link NEvent.id} (lowercase), kind-1 ingest spam filters do not apply
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
 * Single gate for subscribe/cache/IDB read paths: drop future or pre-Nostr timestamps, kind-1 JSON-object spam,
 * drift.gits.net spam, long opaque random strings, and malformed relay reviews. Optional
 * {@link ShouldDropEventOnIngestOptions} relaxes
 * kind-1 spam drops for explicit id fetch.
 */
export function shouldDropEventOnIngest(
  event: NEvent,
  options?: ShouldDropEventOnIngestOptions
): boolean {
  if (!isPlausibleEventCreatedAt(event.created_at)) return true
  const relaxKind1Spam = explicitLookupMatchesEvent(event.id, options?.explicitNoteLookupHexId)
  if (event.kind === DEPRECATED_NIP71_SHORT_VIDEO_ADDRESSABLE_KIND) return true
  if (isIncompleteRelayReviewIngest(event)) return true
  if (isStringifiedJsonObjectContentNostrEvent(event)) return true
  if (isKactiBroadcastSpamKind1(event)) {
    if (!relaxKind1Spam) return true
  }
  if (isDriftGitsNetSpamKind1(event)) {
    if (!relaxKind1Spam) return true
  }
  if (isLongOpaqueRandomStringKind1(event)) {
    if (!relaxKind1Spam) return true
  }
  return false
}
