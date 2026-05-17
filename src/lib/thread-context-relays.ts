import { urlIsNonLocalForRemoteViewer } from '@/lib/relay-list-sanitize'
import { buildReplyReadRelayList, relayHintsFromEventTags } from '@/lib/relay-list-builder'
import { normalizeUrl } from '@/lib/url'
import type { Event } from 'nostr-tools'

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

/** Relay hint from a single `e` / `E` tag (third field). */
export function relayHintsFromThreadETag(tag: string[] | undefined): string[] {
  if (!tag?.[2] || typeof tag[2] !== 'string') return []
  const n = normalizeUrl(tag[2]) || tag[2]
  if (!n || !urlIsNonLocalForRemoteViewer(n)) return []
  return [n]
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
  const threadRelayHints = [...new Set([...tagHints, ...relayHintsFromEventTags(contextEvent)])]
  const opAuthorPubkey = pubkeyFromThreadETag(targetTag)
  return buildReplyReadRelayList(opAuthorPubkey, viewerPubkey, blockedRelays, threadRelayHints)
}
