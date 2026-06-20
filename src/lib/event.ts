import { ExtendedKind, isNip52CalendarCardKind } from '@/constants'
import { getWebBookmarkReplaceableEventNaddr } from '@/lib/web-bookmark-nip'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { muteSetHas } from '@/lib/mute-set'
import { EMBEDDED_EVENT_REGEX, EMBEDDED_MENTION_REGEX, NOSTR_EMBEDDED_NOTE_REGEX } from '@/lib/content-patterns'
import { cleanUrl, normalizeUrl } from '@/lib/url'
import { urlIsNonLocalForRemoteViewer } from '@/lib/relay-list-sanitize'
import client from '@/services/client.service'
import { TImetaInfo } from '@/types'
import { LRUCache } from 'lru-cache'
import { Event, kinds, nip19, UnsignedEvent } from 'nostr-tools'
import { minePow as nip13MinePow } from 'nostr-tools/nip13'
import { hexPubkeysEqual, normalizeHexPubkey } from './pubkey'
import {
  generateBech32IdFromATag,
  generateBech32IdFromETag,
  getFirstHexEventIdFromETags,
  getImetaInfoFromImetaTag,
  getNip25ReactionTargetHexFromTags,
  tagNameEquals
} from './tag'

/** NIP-25: kind 7 (nostr target) or kind 17 (external / NIP-73 `k`+`i`). */
export function isNip25ReactionKind(kind: number): boolean {
  return kind === kinds.Reaction || kind === ExtendedKind.EXTERNAL_REACTION
}

/** NIP-18: kind 6 (kind-1 repost) or kind 16 (generic repost). */
export function isNip18RepostKind(kind: number): boolean {
  return kind === kinds.Repost || kind === ExtendedKind.GENERIC_REPOST
}

/**
 * Target id for NIP-18 repost rows (stats + feed dedupe): `e` first, then embedded JSON `id`, then `a` on generic repost.
 * Mirrors {@link NoteStatsService} repost classification so boost strips and “skip duplicate row” agree with stats.
 */
export function getNip18RepostTargetId(evt: Event): string | undefined {
  if (!isNip18RepostKind(evt.kind)) return undefined

  const hex = getFirstHexEventIdFromETags(evt.tags)
  if (hex) return hex.toLowerCase()

  const raw = evt.content?.trim()
  if (raw) {
    try {
      const embedded = JSON.parse(raw) as { id?: string }
      if (embedded.id && /^[0-9a-f]{64}$/i.test(embedded.id)) {
        return embedded.id.toLowerCase()
      }
    } catch {
      /* ignore */
    }
  }

  if (evt.kind === ExtendedKind.GENERIC_REPOST) {
    const aTag = evt.tags.find(tagNameEquals('a')) ?? evt.tags.find(tagNameEquals('A'))
    const coord = aTag?.[1]?.trim()
    if (coord) return coord
  }
  return undefined
}

/** NIP-56: kind 1984 report / flag (`kinds.Report` and {@link ExtendedKind.REPORT} are the same kind). */
export function isNip56ReportEvent(event: Pick<Event, 'kind'>): boolean {
  return event.kind === kinds.Report || event.kind === ExtendedKind.REPORT
}

/** `e` / `E` tags for NIP-10-style thread links (kinds 1, 11, 1111, …). */
function listThreadLinkETags(event: Event): string[][] {
  return event.tags.filter(([n]) => n === 'e' || n === 'E')
}

/** Hex note ids on `e`/`E` that are not this event's id (some clients emit a bogus self-`e` on kind 1111). */
function listThreadLinkETagsExcludingSelf(event: Event): string[][] {
  const self = event.id.toLowerCase()
  return listThreadLinkETags(event).filter(
    ([, id]) => typeof id === 'string' && /^[0-9a-f]{64}$/i.test(id) && id.toLowerCase() !== self
  )
}

/**
 * Parent `e` for kind 1111 / voice comment: prefer `reply` marker, else last `e` when multiple
 * (NIP-10 root-then-reply), else first. Avoids treating the thread root as the parent when clients omit uppercase `E`.
 * Ignores `e`/`E` whose id is this event (bad self-links); parent then falls through to {@link getParentATag} / naddr.
 */
function getParentETagCommentOrDiscussion(event: Event): string[] | undefined {
  const isETag = (n: string) => n === 'e' || n === 'E'
  const self = event.id.toLowerCase()
  const byMarker = event.tags.find(([tagName, id, , marker]) => {
    if (!isETag(tagName) || marker !== 'reply' || typeof id !== 'string') return false
    if (!/^[0-9a-f]{64}$/i.test(id)) return false
    return id.toLowerCase() !== self
  })
  if (byMarker) return byMarker
  const etags = listThreadLinkETagsExcludingSelf(event).filter(([, , , marker]) => marker !== 'edit')
  if (etags.length >= 2) return etags[etags.length - 1]
  return etags[0]
}

/**
 * Root `e` for kind 1111 / voice comment: prefer `root` marker, else uppercase `E` (Imwald / NIP-22),
 * else first `e` when multiple (NIP-10 root-before-reply), else single `e`.
 */
function getRootETagCommentOrDiscussion(event: Event): string[] | undefined {
  const isETag = (n: string) => n === 'e' || n === 'E'
  const self = event.id.toLowerCase()
  const byMarker = event.tags.find(([tagName, id, , marker]) => {
    if (!isETag(tagName) || marker !== 'root' || typeof id !== 'string') return false
    if (!/^[0-9a-f]{64}$/i.test(id)) return false
    return id.toLowerCase() !== self
  })
  if (byMarker) return byMarker
  const upperE = event.tags.find(
    (t) => t[0] === 'E' && typeof t[1] === 'string' && /^[0-9a-f]{64}$/i.test(t[1]) && t[1].toLowerCase() !== self
  )
  if (upperE) return upperE
  const etags = listThreadLinkETagsExcludingSelf(event).filter(([, , , marker]) => marker !== 'edit')
  if (etags.length >= 2) return etags[0]
  return etags[0]
}

const EVENT_EMBEDDED_NOTES_CACHE = new LRUCache<string, string[]>({ max: 10000 })
const EVENT_EMBEDDED_PUBKEYS_CACHE = new LRUCache<string, string[]>({ max: 10000 })
const EVENT_IS_REPLY_NOTE_CACHE = new LRUCache<string, boolean>({ max: 10000 })
/** Bump when isReplyNoteEvent logic changes so cached booleans are not stale. */
const IS_REPLY_NOTE_CACHE_KEY_SUFFIX = ':v3'

export function isNsfwEvent(event: Event) {
  return event.tags.some(
    ([tagName, tagValue]) =>
      tagName === 'content-warning' || (tagName === 't' && tagValue.toLowerCase() === 'nsfw')
  )
}

export function isReplyNoteEvent(event: Event) {
  if ([ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT, 1111].includes(event.kind)) {
    return true
  }

  // Zap receipts and payment notifications are thread replies when they reference a note or addressable event.
  if (event.kind === kinds.Zap || event.kind === ExtendedKind.PAYMENT_NOTIFICATION) {
    return event.tags.some((tag) => tag[0] === 'e' || tag[0] === 'a')
  }

  if (event.kind !== kinds.ShortTextNote) return false

  const cacheKey = event.id + IS_REPLY_NOTE_CACHE_KEY_SUFFIX
  const cache = EVENT_IS_REPLY_NOTE_CACHE.get(cacheKey)
  if (cache !== undefined) return cache

  // NIP-18 `q` without `e`/`a` is a quote note (top-level for OP vs reply filters), not a thread reply.
  const isReply = !!getParentETag(event) || !!getParentATag(event)
  EVENT_IS_REPLY_NOTE_CACHE.set(cacheKey, isReply)
  return isReply
}

export function isReplaceableEvent(kind: number) {
  return (
    kinds.isReplaceableKind(kind) ||
    kinds.isAddressableKind(kind) ||
    isNip52CalendarCardKind(kind)
  )
}

export function isProtectedEvent(event: Event) {
  return event.tags.some(([tagName]) => tagName === '-')
}

export function isMentioningMutedUsers(event: Event, mutePubkeySet: Set<string>) {
  for (const [tagName, pubkey] of event.tags) {
    if (tagName === 'p' && muteSetHas(mutePubkeySet, pubkey)) {
      return true
    }
  }
  return false
}

export function getParentETag(event?: Event) {
  if (!event) return undefined

  // NIP-25 reactions: reacted-to id is often the `reply`-marked `e`, not the first `e` (root is commonly first).
  if (event.kind === kinds.Reaction) {
    const targetHex = getNip25ReactionTargetHexFromTags(event.tags)
    if (!targetHex) return undefined
    return (
      event.tags.find(
        (t) => t[0] === 'e' && typeof t[1] === 'string' && t[1].toLowerCase() === targetHex
      ) ??
      event.tags.find(
        (t) => t[0] === 'E' && typeof t[1] === 'string' && t[1].toLowerCase() === targetHex
      )
    )
  }

  // NIP-18 reposts (6 / 16), poll responses: first hex `e` / `E` references the target note.
  if (isNip18RepostKind(event.kind) || event.kind === ExtendedKind.POLL_RESPONSE) {
    const firstId = getFirstHexEventIdFromETags(event.tags)
    if (!firstId) return undefined
    return (
      event.tags.find((t) => t[0] === 'e' && t[1] === firstId) ??
      event.tags.find((t) => t[0] === 'E' && t[1] === firstId)
    )
  }

  if (event.kind === ExtendedKind.COMMENT || event.kind === ExtendedKind.VOICE_COMMENT) {
    return getParentETagCommentOrDiscussion(event)
  }

  // Kind 11: keep first `e` / `E` (thread shape differs from NIP-10 comment chains).
  if (event.kind === ExtendedKind.DISCUSSION) {
    return event.tags.find(tagNameEquals('e')) ?? event.tags.find(tagNameEquals('E'))
  }

  // Kind 9735 / 9740: referenced note id is on `e` / `E` (or addressable target on `a` / `A`).
  if (
    event.kind === kinds.Zap ||
    event.kind === ExtendedKind.ZAP_RECEIPT ||
    event.kind === ExtendedKind.PAYMENT_NOTIFICATION ||
    event.kind === ExtendedKind.MONERO_TIP_DISCLOSURE ||
    event.kind === ExtendedKind.MONERO_TIP_RECEIPT
  ) {
    const firstHex = getFirstHexEventIdFromETags(event.tags)
    if (firstHex) {
      return (
        event.tags.find((t) => t[0] === 'e' && t[1] === firstHex) ??
        event.tags.find((t) => t[0] === 'E' && t[1] === firstHex)
      )
    }
    return event.tags.find(tagNameEquals('e')) ?? event.tags.find(tagNameEquals('E'))
  }

  if (event.kind !== kinds.ShortTextNote) return undefined

  const isETag = (n: string) => n === 'e' || n === 'E'
  let tag = event.tags.find(([tagName, , , marker]) => {
    return isETag(tagName) && marker === 'reply'
  })
  if (!tag) {
    const embeddedEventIds = getEmbeddedNoteBech32Ids(event)
    tag = event.tags.findLast(
      ([tagName, tagValue, , marker]) =>
        isETag(tagName) &&
        !!tagValue &&
        marker !== 'mention' &&
        marker !== 'edit' &&
        !embeddedEventIds.includes(tagValue)
    )
  }
  return tag
}

export function getParentATag(event?: Event) {
  if (!event) return undefined
  if (
    event.kind === kinds.Zap ||
    event.kind === ExtendedKind.ZAP_RECEIPT ||
    event.kind === ExtendedKind.PAYMENT_NOTIFICATION ||
    event.kind === ExtendedKind.MONERO_TIP_DISCLOSURE ||
    event.kind === ExtendedKind.MONERO_TIP_RECEIPT
  ) {
    return event.tags.find(tagNameEquals('a')) ?? event.tags.find(tagNameEquals('A'))
  }
  if (
    ![kinds.ShortTextNote, ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT, ExtendedKind.DISCUSSION].includes(event.kind)
  ) {
    return undefined
  }

  return event.tags.find(tagNameEquals('a')) ?? event.tags.find(tagNameEquals('A'))
}

export function getParentEventHexId(event?: Event) {
  const tag = getParentETag(event)
  return tag?.[1]
}

export function getParentBech32Id(event?: Event) {
  const eTag = getParentETag(event)
  if (!eTag) {
    const aTag = getParentATag(event)
    if (!aTag) return undefined

    return generateBech32IdFromATag(aTag)
  }

  return generateBech32IdFromETag(eTag)
}

export function getRootETag(event?: Event) {
  if (!event) return undefined

  if (event.kind === ExtendedKind.COMMENT || event.kind === ExtendedKind.VOICE_COMMENT) {
    return getRootETagCommentOrDiscussion(event)
  }

  if (event.kind === ExtendedKind.DISCUSSION) {
    return event.tags.find(tagNameEquals('E'))
  }

  // Kind 9735 / 9736 / 1814: thread root for note tips is the referenced event id on `e` / `E`
  if (
    event.kind === kinds.Zap ||
    event.kind === ExtendedKind.ZAP_RECEIPT ||
    event.kind === ExtendedKind.MONERO_TIP_DISCLOSURE ||
    event.kind === ExtendedKind.MONERO_TIP_RECEIPT
  ) {
    const firstHex = getFirstHexEventIdFromETags(event.tags)
    if (firstHex) {
      return (
        event.tags.find((t) => t[0] === 'e' && t[1] === firstHex) ??
        event.tags.find((t) => t[0] === 'E' && t[1] === firstHex)
      )
    }
    if (event.kind === kinds.Zap || event.kind === ExtendedKind.ZAP_RECEIPT) {
      const zapped = getZapInfoFromEvent(event)?.originalEventId
      if (zapped && /^[0-9a-f]{64}$/i.test(zapped)) {
        const hex = zapped.toLowerCase()
        return (
          event.tags.find((t) => t[0] === 'e' && t[1]?.toLowerCase() === hex) ??
          event.tags.find((t) => t[0] === 'E' && t[1]?.toLowerCase() === hex) ??
          ['e', hex]
        )
      }
    }
    return undefined
  }

  if (event.kind !== kinds.ShortTextNote) return undefined

  const isETag = (n: string) => n === 'e' || n === 'E'
  let tag = event.tags.find(([tagName, , , marker]) => {
    return isETag(tagName) && marker === 'root'
  })
  if (!tag) {
    const embeddedEventIds = getEmbeddedNoteBech32Ids(event)
    tag = event.tags.find(
      ([tagName, tagValue]) =>
        isETag(tagName) && !!tagValue && !embeddedEventIds.includes(tagValue)
    )
  }
  return tag
}

export function getRootATag(event?: Event) {
  if (!event) return undefined
  if (event.kind === kinds.Zap) {
    return event.tags.find(tagNameEquals('a')) ?? event.tags.find(tagNameEquals('A'))
  }
  if (
    ![kinds.ShortTextNote, ExtendedKind.COMMENT, ExtendedKind.VOICE_COMMENT, ExtendedKind.DISCUSSION].includes(event.kind)
  ) {
    return undefined
  }

  return event.tags.find(tagNameEquals('A'))
}

export function getRootEventHexId(event?: Event) {
  const tag = getRootETag(event)
  return tag?.[1]
}

const RESOLVE_DECLARED_THREAD_ROOT_MAX_HOPS = 14

/** Zapped **note** id from a kind 9735 receipt (`e` / `E` hex). Kept here to avoid importing event-metadata (cycles). */
function zapReceiptTargetNoteHexFromEvent(ev: Event): string | undefined {
  if (ev.kind !== kinds.Zap) return undefined
  for (const t of ev.tags) {
    if ((t[0] === 'e' || t[0] === 'E') && t[1] && /^[0-9a-f]{64}$/i.test(t[1])) {
      return t[1].toLowerCase()
    }
  }
  return undefined
}

/**
 * Clients that reply from a notification often emit a single `e` tag whose **id is a reaction** (kind 7 / 17)
 * or **zap receipt** (kind 9735) but the marker is still `root` — they never saw the real OP. Walk
 * reaction / zap → target note → further NIP-10 `e` roots (session cache) until stable, for thread UI and child `root` tags.
 */
export function resolveDeclaredThreadRootEventHex(startHexId: string): string {
  let cur = startHexId.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/i.test(cur)) return cur
  const seen = new Set<string>()
  for (let hop = 0; hop < RESOLVE_DECLARED_THREAD_ROOT_MAX_HOPS; hop++) {
    if (seen.has(cur)) return cur
    seen.add(cur)
    const ev = client.peekSessionCachedEvent(cur)
    if (!ev) return cur
    if (isNip25ReactionKind(ev.kind)) {
      const fromParent = getParentEventHexId(ev)?.toLowerCase()
      let next: string | undefined
      if (fromParent && /^[0-9a-f]{64}$/i.test(fromParent)) {
        next = fromParent
      } else {
        const first = getFirstHexEventIdFromETags(ev.tags)
        next = first && /^[0-9a-f]{64}$/i.test(first) ? first.toLowerCase() : undefined
      }
      if (!next || next === cur) return cur
      cur = next
      continue
    }
    if (ev.kind === kinds.Zap) {
      const next = zapReceiptTargetNoteHexFromEvent(ev)
      if (!next || next === cur) return cur
      cur = next
      continue
    }
    const r = getRootEventHexId(ev)?.toLowerCase()
    if (r && r !== cur && /^[0-9a-f]{64}$/i.test(r)) {
      cur = r
      continue
    }
    return cur
  }
  return cur
}

export function getRootBech32Id(event?: Event) {
  const eTag = getRootETag(event)
  if (!eTag) {
    const aTag = getRootATag(event)
    if (!aTag) return undefined

    return generateBech32IdFromATag(aTag)
  }

  return generateBech32IdFromETag(eTag)
}

export function getReplaceableCoordinate(kind: number, pubkey: string, d: string = '') {
  return `${kind}:${pubkey}:${d}`
}

export function getReplaceableCoordinateFromEvent(event: Event) {
  const d = event.tags.find(tagNameEquals('d'))?.[1] ?? ''
  return getReplaceableCoordinate(event.kind, event.pubkey, d)
}

/**
 * Merge key for NIP-33 addressable events when relays return different ids for the same logical
 * replaceable. Normalized `kind:pubkey:d`; missing/empty `d` or non-addressable kinds use `event.id`.
 */
export function replaceableEventDedupeKey(event: Event): string {
  if (!kinds.isAddressableKind(event.kind)) return event.id
  const d = event.tags.find(tagNameEquals('d'))?.[1]
  if (d == null || d === '') return event.id
  return normalizeReplaceableCoordinateString(getReplaceableCoordinateFromEvent(event))
}

/** Normalize `kind:pubkey:d` for comparisons (lowercase pubkey; preserve d). */
export function normalizeReplaceableCoordinateString(coord: string): string {
  const m = /^(\d+):([0-9a-f]{64}):(.*)$/i.exec(coord.trim())
  if (!m) return coord.trim().toLowerCase()
  return getReplaceableCoordinate(Number(m[1]), m[2].toLowerCase(), m[3])
}

function stripNostrUriScheme(s: string): string {
  const t = s.trim()
  if (t.toLowerCase().startsWith('nostr:')) return t.slice(6).trim()
  return t
}

/**
 * NIP-10 / NIP-18: `q` tag value is `<event-id>` or `<event-address>` (coordinate), or NIP-19 bech32.
 */
function parseQTagReferenceValue(
  raw: string | undefined | null
): { hexId?: string; coordinate?: string } | undefined {
  if (raw == null) return undefined
  const s0 = stripNostrUriScheme(raw)
  if (!s0) return undefined

  if (/^[0-9a-f]{64}$/i.test(s0)) {
    return { hexId: s0.toLowerCase() }
  }

  const coordMatch = /^(\d+):([0-9a-f]{64}):(.*)$/i.exec(s0)
  if (coordMatch) {
    return {
      coordinate: getReplaceableCoordinate(
        Number(coordMatch[1]),
        coordMatch[2].toLowerCase(),
        coordMatch[3]
      )
    }
  }

  if (/^n(?:ote|event|addr)1/i.test(s0)) {
    try {
      const { type, data } = nip19.decode(s0)
      if (type === 'note') {
        const id = typeof data === 'string' ? data : (data as { id?: string }).id
        if (id && /^[0-9a-f]{64}$/i.test(id)) return { hexId: id.toLowerCase() }
      }
      if (type === 'nevent') {
        const id = (data as { id: string }).id
        if (id && /^[0-9a-f]{64}$/i.test(id)) return { hexId: id.toLowerCase() }
      }
      if (type === 'naddr') {
        const d = data as { kind: number; pubkey: string; identifier: string }
        return {
          coordinate: getReplaceableCoordinate(
            d.kind,
            d.pubkey.toLowerCase(),
            d.identifier ?? ''
          )
        }
      }
    } catch {
      /* invalid bech32 */
    }
  }

  return undefined
}

/** Parsed first `q` / `Q` tag on the event (NIP-10). */
export function getQuotedReferenceFromQTags(event: Event): {
  hexId?: string
  coordinate?: string
} | undefined {
  const q = event.tags.find((t) => t[0] === 'q' || t[0] === 'Q')?.[1]
  return parseQTagReferenceValue(q)
}

/** Hex id from `q` when the reference resolves to a fixed id (not coordinate-only). */
export function getQuotedEventHexIdFromQTags(event: Event): string | undefined {
  return getQuotedReferenceFromQTags(event)?.hexId
}

/** Kind 1 quote-of-root: match `q` hex and/or replaceable coordinate (and bech32 decoding). */
export function kind1QuotesThreadRoot(
  event: Event,
  root: { type: 'E'; id: string } | { type: 'A'; id: string; eventId: string }
): boolean {
  if (event.kind !== kinds.ShortTextNote) return false
  const ref = getQuotedReferenceFromQTags(event)
  if (!ref || (!ref.hexId && !ref.coordinate)) return false
  if (root.type === 'E') {
    const rid = root.id.trim().toLowerCase()
    return !!ref.hexId && ref.hexId === rid
  }
  const eid = root.eventId.trim().toLowerCase()
  const coordNorm = normalizeReplaceableCoordinateString(root.id)
  if (ref.hexId && ref.hexId === eid) return true
  if (ref.coordinate && normalizeReplaceableCoordinateString(ref.coordinate) === coordNorm) return true
  return false
}

/** Whether an event matches a tombstone key from IndexedDB (e-tag id, a-tag coordinate, or k-tag kind:pubkey). */
export function isTombstoneKeyForEvent(event: Event, tombstones: Set<string>): boolean {
  if (tombstones.has(event.id)) return true
  if (isReplaceableEvent(event.kind)) {
    if (tombstones.has(getReplaceableCoordinateFromEvent(event))) return true
    if (tombstones.has(`${event.kind}:${event.pubkey}`)) return true
  }
  return false
}

export function filterEventsExcludingTombstones(events: Event[], tombstones: Set<string>): Event[] {
  if (tombstones.size === 0) return events
  return events.filter((e) => !isTombstoneKeyForEvent(e, tombstones))
}

export function getNoteBech32Id(event: Event) {
  const hints = client.getEventHints(event.id).slice(0, 2)
  if (isReplaceableEvent(event.kind)) {
    const identifier = event.tags.find(tagNameEquals('d'))?.[1] ?? ''
    return nip19.naddrEncode({ pubkey: event.pubkey, kind: event.kind, identifier, relays: hints })
  }
  return nip19.neventEncode({ id: event.id, author: event.pubkey, kind: event.kind, relays: hints })
}

export function getUsingClient(event: Event) {
  const clientTag = event.tags.find(tagNameEquals('client'))
  if (!clientTag) return undefined

  // NIP-89 client tag format: ["client", "Client Name", "31990:pubkey:identifier", "relay"]
  // Simple format: ["client", "client_name"]
  const name = clientTag[1]
  if (!name) return undefined
  if (name.toLowerCase() === 'imwald') return 'Imwald'
  return name
}

export function getImetaInfosFromEvent(event: Event) {
  const imeta: TImetaInfo[] = []
  event.tags.forEach((tag) => {
    const imageInfo = getImetaInfoFromImetaTag(tag, event.pubkey)
    if (imageInfo) {
      imeta.push(imageInfo)
    }
  })
  return imeta
}

function getEmbeddedNoteBech32Ids(event: Event) {
  const cache = EVENT_EMBEDDED_NOTES_CACHE.get(event.id)
  if (cache) return cache

  const embeddedNoteBech32Ids: string[] = []
  ;(event.content.match(NOSTR_EMBEDDED_NOTE_REGEX) || []).forEach((note) => {
    try {
      const { type, data } = nip19.decode(note.split(':')[1])
      if (type === 'nevent') {
        embeddedNoteBech32Ids.push(data.id)
      } else if (type === 'note') {
        embeddedNoteBech32Ids.push(data)
      }
    } catch {
      // ignore
    }
  })
  EVENT_EMBEDDED_NOTES_CACHE.set(event.id, embeddedNoteBech32Ids)
  return embeddedNoteBech32Ids
}

/**
 * Collect targets to prefetch so embedded notes (and reply roots) resolve into session cache.
 * - `hexIds`: lowercase event ids (e tags, a-tag snapshot, nostr:note1 / nevent1 in content).
 * - `nip19Pointers`: bech32 strings (e.g. naddr) for per-pointer fetches — not batchable as a single `ids` filter.
 */
export function collectEmbeddedEventPrefetchTargets(event: Event): {
  hexIds: string[]
  nip19Pointers: string[]
} {
  const hexSet = new Set<string>()
  const nip19Set = new Set<string>()

  const addHex = (id: string | undefined) => {
    if (!id) return
    const t = id.trim().toLowerCase()
    if (/^[0-9a-f]{64}$/.test(t)) hexSet.add(t)
  }

  for (const tag of event.tags) {
    if ((tag[0] === 'e' || tag[0] === 'E') && tag[1]) addHex(tag[1])
    if ((tag[0] === 'a' || tag[0] === 'A') && tag[3]) addHex(tag[3])
  }

  for (const full of event.content.match(EMBEDDED_EVENT_REGEX) ?? []) {
    const colon = full.indexOf(':')
    if (colon < 0) continue
    const bech32 = full.slice(colon + 1)
    try {
      const { type, data } = nip19.decode(bech32)
      if (type === 'note') addHex(data)
      else if (type === 'nevent') addHex(data.id)
      else if (type === 'naddr') nip19Set.add(bech32)
    } catch {
      /* ignore */
    }
  }

  // Discussion roots (kind 11) usually do not reference their own id in tags/content; include the
  // row id so feed prefetch + open-note `fetchEvent` hit session cache after the list has loaded.
  if (event.kind === ExtendedKind.DISCUSSION) {
    addHex(event.id)
  }

  const bookmarkNaddr = getWebBookmarkReplaceableEventNaddr(event)
  if (bookmarkNaddr) nip19Set.add(bookmarkNaddr)

  return {
    hexIds: Array.from(hexSet),
    nip19Pointers: Array.from(nip19Set)
  }
}

/**
 * `wss://` / `ws://` hints from `e`/`a`/`q` third field, `relays` tags, and relays that delivered the parent event.
 * Used to resolve embedded notes from the same context (e.g. long-form body) before the generic relay fan-out.
 */
export function relayHintWssUrlsFromEvent(event: Event | undefined): string[] {
  if (!event) return []
  const fromTags: string[] = []
  for (const tag of event.tags) {
    if (['e', 'a', 'q'].includes(tag[0]) && tag.length > 2 && typeof tag[2] === 'string') {
      const hint = tag[2]
      if (hint.startsWith('wss://') || hint.startsWith('ws://')) {
        const n = normalizeUrl(hint) || hint
        if (urlIsNonLocalForRemoteViewer(n)) fromTags.push(hint)
      }
    }
  }
  const relaysTag = event.tags.find((t) => t[0] === 'relays')
  if (relaysTag) {
    for (let i = 1; i < relaysTag.length; i++) {
      const u = relaysTag[i]
      if (typeof u === 'string' && (u.startsWith('wss://') || u.startsWith('ws://'))) {
        const n = normalizeUrl(u) || u
        if (urlIsNonLocalForRemoteViewer(n)) fromTags.push(u)
      }
    }
  }
  const seen: string[] = []
  try {
    seen.push(...client.getSeenEventRelayUrls(event.id))
  } catch {
    /* ignore */
  }
  const hints = [...fromTags, ...seen]
  const normalized = hints
    .map((u) => normalizeUrl(u))
    .filter((u): u is string => Boolean(u))
  return [...new Set(normalized)]
}

/** Deduped wss hints with parent `a`/`e`/`q` relays that match the embedded pointer listed first. */
export function relayHintsForEmbeddedNotePointer(
  notePointer: string,
  containingEvent?: Event
): string[] {
  if (!containingEvent) return []
  const prioritized: string[] = []
  const pushHint = (raw: string | undefined) => {
    const hint = raw?.trim()
    if (!hint || (!hint.startsWith('wss://') && !hint.startsWith('ws://'))) return
    const n = normalizeUrl(hint) || hint
    if (urlIsNonLocalForRemoteViewer(n)) prioritized.push(hint)
  }
  const trimmed = notePointer.trim()

  let naddrCoord: string | undefined
  let targetHex: string | undefined
  try {
    const { type, data } = nip19.decode(trimmed)
    if (type === 'naddr') {
      naddrCoord = normalizeReplaceableCoordinateString(
        getReplaceableCoordinate(data.kind, data.pubkey, data.identifier ?? '')
      )
      for (const r of data.relays ?? []) pushHint(r)
    } else if (type === 'nevent') {
      targetHex = data.id.toLowerCase()
      for (const r of data.relays ?? []) pushHint(r)
    } else if (type === 'note') {
      targetHex = data.toLowerCase()
    }
  } catch {
    if (/^[0-9a-f]{64}$/i.test(trimmed)) targetHex = trimmed.toLowerCase()
  }

  for (const tag of containingEvent.tags) {
    if (naddrCoord && tag[0] === 'a' && tag[1]?.trim()) {
      const coord = normalizeReplaceableCoordinateString(tag[1].trim())
      if (coord === naddrCoord) pushHint(tag[2])
    }
    if (targetHex && tag[0] === 'e' && tag[1]?.trim().toLowerCase() === targetHex) {
      pushHint(tag[2])
    }
  }

  const merged = [...prioritized, ...relayHintWssUrlsFromEvent(containingEvent)]
  return [
    ...new Set(
      merged.map((u) => normalizeUrl(u)).filter((u): u is string => Boolean(u))
    )
  ]
}

function getEmbeddedPubkeys(event: Event) {
  const cache = EVENT_EMBEDDED_PUBKEYS_CACHE.get(event.id)
  if (cache) return cache

  const embeddedPubkeySet = new Set<string>()
  ;(event.content.match(EMBEDDED_MENTION_REGEX) || []).forEach((mention) => {
    try {
      const { type, data } = nip19.decode(mention.split(':')[1])
      if (type === 'npub') {
        embeddedPubkeySet.add(data)
      } else if (type === 'nprofile') {
        embeddedPubkeySet.add(data.pubkey)
      }
    } catch {
      // ignore
    }
  })
  const embeddedPubkeys = Array.from(embeddedPubkeySet)
  EVENT_EMBEDDED_PUBKEYS_CACHE.set(event.id, embeddedPubkeys)
  return embeddedPubkeys
}

/**
 * Whether `userPubkey` is mentioned on the event: any `p` tag and/or
 * `nostr:npub…` / `nostr:nprofile…` in content (see {@link getEmbeddedPubkeys}).
 * Events authored by the user are excluded (not treated as incoming mentions).
 */
export function isUserInEventMentions(event: Event, userPubkey: string): boolean {
  const u = normalizeHexPubkey(userPubkey)
  if (hexPubkeysEqual(event.pubkey, u)) return false
  const inPtags = event.tags.some((t) => t[0] === 'p' && t[1] && hexPubkeysEqual(t[1], u))
  if (inPtags) return true
  return getEmbeddedPubkeys(event).some((pk) => hexPubkeysEqual(pk, u))
}

export function getLatestEvent(events: Event[]): Event | undefined {
  return events.sort((a, b) => b.created_at - a.created_at)[0]
}

export function getReplaceableEventIdentifier(event: Event) {
  return event.tags.find(tagNameEquals('d'))?.[1] ?? ''
}

export function createFakeEvent(event: Partial<Event>): Event {
  return {
    id: '',
    kind: 1,
    pubkey: '',
    content: '',
    created_at: 0,
    tags: [],
    sig: '',
    ...event
  }
}

function cloneUnsignedEvent(unsigned: UnsignedEvent): UnsignedEvent {
  return {
    kind: unsigned.kind,
    content: unsigned.content,
    tags: unsigned.tags.map((tag) => [...tag]),
    created_at: unsigned.created_at,
    pubkey: unsigned.pubkey
  }
}

/** NIP-13 PoW via {@link nip13MinePow}; clones input so draft tags are not mutated. */
export async function minePow(
  unsigned: UnsignedEvent,
  difficulty: number
): Promise<Omit<Event, 'sig'>> {
  const draft = cloneUnsignedEvent(unsigned)
  return new Promise((resolve) => {
    // Yield once so posting UI can paint before the synchronous mine loop runs.
    setTimeout(() => {
      resolve(nip13MinePow(draft, difficulty))
    }, 0)
  })
}

// Legacy compare function for sorting compatibility
// If return 0, it means the two events are equal.
// If return a negative number, it means `b` should be retained, and `a` should be discarded.
// If return a positive number, it means `a` should be retained, and `b` should be discarded.
export function compareEvents(a: Event, b: Event): number {
  if (a.created_at !== b.created_at) {
    return a.created_at - b.created_at
  }
  // In case of replaceable events with the same timestamp, the event with the lowest id (first in lexical order) should be retained, and the other discarded.
  if (a.id !== b.id) {
    return a.id < b.id ? 1 : -1
  }
  return 0
}

/** External article URL from `i` / `I` tags (e.g. kind 1111 comments on web content). */
export function getHttpUrlFromITags(event: Event): string | undefined {
  const lower = event.tags.find((t) => t[0] === 'i')?.[1]?.trim()
  const upper = event.tags.find((t) => t[0] === 'I')?.[1]?.trim()
  const raw = lower ?? upper
  if (!raw) return undefined
  if (!raw.startsWith('http://') && !raw.startsWith('https://')) return undefined
  return cleanUrl(raw) || raw
}
