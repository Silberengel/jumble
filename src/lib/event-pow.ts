import { getPow } from 'nostr-tools/nip13'
import type { Event } from 'nostr-tools'

/** Fields required for NIP-13 PoW verification (id + tags). */
export type PowVerifiableEvent = Pick<Event, 'id' | 'tags'>

function parseFirstNonceTag(event: PowVerifiableEvent): { nonce: string; difficulty: number } | null {
  for (const tag of event.tags) {
    if (tag[0] !== 'nonce') continue
    const nonce = tag[1]?.trim()
    const difficulty = parseInt(String(tag[2] ?? ''), 10)
    if (!nonce || !Number.isFinite(difficulty) || difficulty <= 0) return null
    return { nonce, difficulty }
  }
  return null
}

/** Whether the event id meets the committed difficulty in its first `nonce` tag (NIP-13). */
export function isEventNoncePowVerified(event: PowVerifiableEvent): boolean {
  const parsed = parseFirstNonceTag(event)
  if (!parsed) return false
  return getPow(event.id) >= parsed.difficulty
}

/**
 * Committed PoW difficulty from the first `nonce` tag, or null if missing or not verified
 * against the event id (NIP-13).
 */
export function getEventNoncePowDifficulty(event: PowVerifiableEvent): number | null {
  const parsed = parseFirstNonceTag(event)
  if (!parsed) return null
  if (getPow(event.id) < parsed.difficulty) return null
  return parsed.difficulty
}
