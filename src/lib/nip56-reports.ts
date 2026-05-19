import { isNip56ReportEvent } from '@/lib/event'
import { hexPubkeysEqual, normalizeHexPubkey } from '@/lib/pubkey'
import { Event } from 'nostr-tools'

/** NIP-56: report targets this pubkey via a `p` tag. */
export function reportTargetsPubkey(event: Event, pubkey: string): boolean {
  if (!isNip56ReportEvent(event)) return false
  let pkNorm: string
  try {
    pkNorm = normalizeHexPubkey(pubkey).toLowerCase()
  } catch {
    pkNorm = pubkey.trim().toLowerCase()
  }
  return event.tags.some((t) => {
    if (t[0] !== 'p' && t[0] !== 'P') return false
    if (typeof t[1] !== 'string') return false
    try {
      return hexPubkeysEqual(normalizeHexPubkey(t[1]), pkNorm)
    } catch {
      return t[1].trim().toLowerCase() === pkNorm
    }
  })
}

/** NIP-56: report published by this pubkey. */
export function isReportAuthoredBy(event: Event, pubkey: string): boolean {
  if (!isNip56ReportEvent(event)) return false
  try {
    return hexPubkeysEqual(normalizeHexPubkey(event.pubkey), normalizeHexPubkey(pubkey))
  } catch {
    return event.pubkey.trim().toLowerCase() === pubkey.trim().toLowerCase()
  }
}
