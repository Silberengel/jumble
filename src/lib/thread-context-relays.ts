import { ExtendedKind } from '@/constants'
import {
  getParentEventHexId,
  getRootETag,
  isReplyNoteEvent,
  resolveDeclaredThreadRootEventHex
} from '@/lib/event'
import { prependAggrForEventLookupRelayUrls } from '@/lib/nostr-land-relay-eligibility'
import { isValidPubkey } from '@/lib/pubkey'
import { sanitizeRelayUrlsForFetch } from '@/lib/read-only-relay-personal'
import { normalizeWssRelayHintUrl } from '@/lib/relay-list-sanitize'
import { buildReplyReadRelayList, relayHintsFromEventTags } from '@/lib/relay-list-builder'
import client from '@/services/client.service'
import { kinds, type Event } from 'nostr-tools'

/** NIP-10 optional pubkey on an `e` tag (field 4 when field 3 is a marker). */
export function pubkeyFromThreadETag(tag: string[] | undefined): string | undefined {
  if (!tag) return undefined
  const markerOrPubkey = tag[3]
  const pubkeyField = tag[4]
  const candidates = [pubkeyField, markerOrPubkey]
  for (const v of candidates) {
    if (typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v)) {
      return v.toLowerCase()
    }
  }
  return undefined
}

/**
 * Thread root (OP) author for inbox targeting when replying under a nested note.
 * Uses `P` / root `e`/`E` tags on the parent, then session cache for the root id.
 */
export function peekThreadRootAuthorPubkey(parentEvent: Event): string | undefined {
  if (
    parentEvent.kind === ExtendedKind.COMMENT ||
    parentEvent.kind === ExtendedKind.VOICE_COMMENT
  ) {
    const pTag = parentEvent.tags.find((t) => t[0] === 'P' && t[1])
    if (pTag?.[1] && isValidPubkey(pTag[1])) return pTag[1].toLowerCase()
  }

  const rootTag = getRootETag(parentEvent)
  if (rootTag) {
    const fromTag = pubkeyFromThreadETag(rootTag)
    if (fromTag) return fromTag
    const rootHex = rootTag[1]?.trim().toLowerCase()
    if (rootHex && /^[0-9a-f]{64}$/i.test(rootHex)) {
      const resolved = resolveDeclaredThreadRootEventHex(rootHex)
      const rootEv = client.peekSessionCachedEvent(resolved)
      if (rootEv?.pubkey && isValidPubkey(rootEv.pubkey)) return rootEv.pubkey.toLowerCase()
    }
  }

  if (parentEvent.kind === kinds.ShortTextNote && !isReplyNoteEvent(parentEvent)) {
    return parentEvent.pubkey.toLowerCase()
  }

  return undefined
}

const THREAD_ROOT_PARENT_WALK_MAX_HOPS = 14

/**
 * Thread root event id when inferable from NIP-22 `E`, NIP-10 root `e`, or a cached parent walk.
 * Session cache only — never blocks on relay REQ.
 */
export function peekThreadRootEventHex(parentEvent: Event): string | undefined {
  let cur: Event | undefined = parentEvent
  for (let hop = 0; hop < THREAD_ROOT_PARENT_WALK_MAX_HOPS && cur; hop++) {
    const eUpper = cur.tags.find(
      (t) => t[0] === 'E' && typeof t[1] === 'string' && /^[0-9a-f]{64}$/i.test(t[1])
    )
    if (eUpper?.[1]) return resolveDeclaredThreadRootEventHex(eUpper[1].toLowerCase())

    if (cur.kind === kinds.ShortTextNote && !isReplyNoteEvent(cur)) {
      return cur.id.toLowerCase()
    }

    const rootTag = getRootETag(cur)
    if (rootTag?.[1] && /^[0-9a-f]{64}$/i.test(rootTag[1])) {
      const resolved = resolveDeclaredThreadRootEventHex(rootTag[1].toLowerCase())
      const curId = cur.id?.toLowerCase()
      if (!curId || resolved !== curId) return resolved
    }

    const parentHex = getParentEventHexId(cur)?.trim().toLowerCase()
    if (!parentHex || !/^[0-9a-f]{64}$/.test(parentHex)) break
    const next = client.peekSessionCachedEvent(parentHex)
    const curId = cur.id?.toLowerCase()
    if (!next?.id || (curId && next.id.toLowerCase() === curId)) break
    cur = next
  }

  const rootTag = getRootETag(parentEvent)
  if (rootTag?.[1] && /^[0-9a-f]{64}$/i.test(rootTag[1])) {
    return resolveDeclaredThreadRootEventHex(rootTag[1].toLowerCase())
  }

  if (parentEvent.kind === kinds.ShortTextNote && !isReplyNoteEvent(parentEvent)) {
    return parentEvent.id.toLowerCase()
  }

  return undefined
}

/**
 * Pubkeys whose read inboxes should receive a thread reply: direct parent author plus thread OP
 * when they differ (aitherboard2-style `fetchRecipientInbox` for thread + parent).
 */
export function collectThreadReplyInboxPubkeys(
  parentEvent: Event,
  excludePubkey?: string
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (pk: string | undefined) => {
    if (!pk || !isValidPubkey(pk)) return
    const norm = pk.toLowerCase()
    if (excludePubkey && norm === excludePubkey.toLowerCase()) return
    if (seen.has(norm)) return
    seen.add(norm)
    out.push(norm)
  }

  add(parentEvent.pubkey)
  const rootOp = peekThreadRootAuthorPubkey(parentEvent)
  if (rootOp) add(rootOp)

  for (const t of parentEvent.tags) {
    if ((t[0] === 'p' || t[0] === 'P') && t[1]) add(t[1])
  }

  return out
}

/** Relay hint from a single `e` / `E` tag (third field). */
export function relayHintsFromThreadETag(tag: string[] | undefined): string[] {
  if (!tag?.[2] || typeof tag[2] !== 'string') return []
  const n = normalizeWssRelayHintUrl(tag[2])
  return n ? [n] : []
}

/**
 * Relays to REQ a thread parent/root: tag-specific hint first, then all `e` hints on the reply,
 * plus author NIP-65 when the referenced note's author pubkey is on the tag.
 */
export async function buildThreadContextFetchRelayUrls(
  contextEvent: Event,
  targetTag: string[] | undefined,
  viewerPubkey: string | undefined,
  blockedRelays: string[] = []
): Promise<string[]> {
  const tagHints = relayHintsFromThreadETag(targetTag)
  const threadRelayHints = sanitizeRelayUrlsForFetch([
    ...new Set([...tagHints, ...relayHintsFromEventTags(contextEvent)])
  ])
  const opAuthorPubkey = pubkeyFromThreadETag(targetTag)
  const relays = await buildReplyReadRelayList(
    opAuthorPubkey,
    viewerPubkey,
    blockedRelays,
    threadRelayHints
  )
  return prependAggrForEventLookupRelayUrls(relays)
}
