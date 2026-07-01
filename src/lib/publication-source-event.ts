import { getNoteBech32Id } from '@/lib/event'
import { isValidPubkey } from '@/lib/pubkey'
import type { Event } from 'nostr-tools'
import { nip19 } from 'nostr-tools'

export type PublicationSourceEventRef = {
  /** Hex event id from the `E` tag, when present. */
  eventId?: string
  relay?: string
  authorPubkey?: string
  /** Bech32 id for navigation (nevent/naddr/note). */
  bech32: string
}

const BECH32_SOURCE_RE = /^(naddr|nevent|note)1[a-z0-9]+$/i
const HEX_EVENT_ID_RE = /^[0-9a-f]{64}$/i

function relayHintFromTag(value: string | undefined): string | undefined {
  const relay = value?.trim()
  if (!relay) return undefined
  if (!relay.startsWith('wss://') && !relay.startsWith('ws://')) return undefined
  return relay
}

/** Parse the kind-30040 source-event `E` tag into a navigable nip-19 id. */
export function getPublicationSourceEventRefFromIndex(event: Event): PublicationSourceEventRef | undefined {
  const eTag = event.tags.find((tag) => (tag[0] || '').trim() === 'E' && tag[1]?.trim())
  if (!eTag) return undefined

  const raw = eTag[1].trim()
  if (BECH32_SOURCE_RE.test(raw)) {
    return { bech32: raw }
  }

  if (!HEX_EVENT_ID_RE.test(raw)) return undefined

  const eventId = raw.toLowerCase()
  const relay = relayHintFromTag(eTag[2])
  const authorRaw = eTag[3]?.trim()
  const authorPubkey = authorRaw && isValidPubkey(authorRaw) ? authorRaw.toLowerCase() : undefined

  try {
    const bech32 = nip19.neventEncode({
      id: eventId,
      author: authorPubkey,
      relays: relay ? [relay] : undefined
    })
    return { eventId, relay, authorPubkey, bech32 }
  } catch {
    return undefined
  }
}

/** Prefer naddr when the fetched source is replaceable; fall back to the index `E` tag encoding. */
export function resolvePublicationSourceEventBech32(
  indexRef: PublicationSourceEventRef,
  fetchedSource?: Event
): string {
  if (fetchedSource) {
    try {
      return getNoteBech32Id(fetchedSource)
    } catch {
      // fall through to index encoding
    }
  }
  return indexRef.bech32
}

export function truncatePublicationSourceBech32(bech32: string): string {
  if (bech32.length <= 36) return bech32
  return `${bech32.slice(0, 28)}…`
}
