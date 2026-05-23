import { ExtendedKind } from '@/constants'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import {
  getReplaceableCoordinate,
  normalizeReplaceableCoordinateString
} from '@/lib/event'
import { hexPubkeysEqual } from '@/lib/pubkey'
import { parsePaytoTagType } from '@/lib/payto'
import { generateBech32IdFromATag } from '@/lib/tag'
import { Event, kinds } from 'nostr-tools'

export const PAYMENT_ATTESTATION_TARGET_KINDS = new Set(['9735', '9740'])

export type PaymentNotificationInfo = {
  senderPubkey: string
  recipientPubkey: string
  amountSats: number
  payto?: string
  comment?: string
  referencedEventId?: string
  referencedCoordinate?: string
}

/** First matching tag value only (duplicate `p` / `e` / `a` tags are ignored). */
function firstTagValue(tags: string[][], names: readonly string[]): string | undefined {
  for (const tag of tags) {
    const name = tag[0]
    const value = tag[1]?.trim()
    if (value && names.includes(name)) return value
  }
  return undefined
}

export function getPaymentAttestationTargetId(attestation: Event): string | undefined {
  if (attestation.kind !== ExtendedKind.PAYMENT_ATTESTATION) return undefined
  const tag = attestation.tags.find(([name]) => name === 'e' || name === 'E')
  const id = tag?.[1]?.trim().toLowerCase()
  return id && /^[0-9a-f]{64}$/.test(id) ? id : undefined
}

export function getPaymentAttestationTargetKind(attestation: Event): string | undefined {
  if (attestation.kind !== ExtendedKind.PAYMENT_ATTESTATION) return undefined
  const tag = attestation.tags.find(([name]) => name === 'k')
  const k = tag?.[1]?.trim()
  return k && PAYMENT_ATTESTATION_TARGET_KINDS.has(k) ? k : undefined
}

/** Event ids (lowercase hex) the recipient has attested as received payment. */
export function buildAttestedPaymentIdSet(
  attestations: Event[],
  recipientPubkey: string
): Set<string> {
  const recipient = recipientPubkey.trim().toLowerCase()
  const out = new Set<string>()
  for (const attestation of attestations) {
    if (attestation.pubkey.toLowerCase() !== recipient) continue
    const targetId = getPaymentAttestationTargetId(attestation)
    const targetKind = getPaymentAttestationTargetKind(attestation)
    if (!targetId || !targetKind) continue
    out.add(targetId)
  }
  return out
}

export function getPaymentNotificationInfo(event: Event): PaymentNotificationInfo | null {
  if (event.kind !== ExtendedKind.PAYMENT_NOTIFICATION) return null

  const recipientPubkey = firstTagValue(event.tags, ['p'])
  if (!recipientPubkey) return null

  const amountTag = firstTagValue(event.tags, ['amount'])
  const amountSats = amountTag ? Math.floor(parseInt(amountTag, 10) / 1000) : 0
  const payto = firstTagValue(event.tags, ['payto'])
  const referencedEventId = firstTagValue(event.tags, ['e', 'E'])?.toLowerCase()
  const referencedCoordinate = firstTagValue(event.tags, ['a', 'A'])

  return {
    senderPubkey: event.pubkey,
    recipientPubkey,
    amountSats,
    payto,
    comment: event.content?.trim() || undefined,
    referencedEventId,
    referencedCoordinate
  }
}

/** Payment category for superchat display (9735 → lightning). */
export function getSuperchatPaytoType(event: Event): string {
  if (event.kind === kinds.Zap) return 'lightning'
  if (event.kind === ExtendedKind.PAYMENT_NOTIFICATION) {
    const payto = getPaymentNotificationInfo(event)?.payto
    return payto ? parsePaytoTagType(payto) : 'unknown'
  }
  return 'unknown'
}

/** Hex event id or `naddr` bech32 for fetching / navigating the superchat target (9740 `e` or `a`). */
export function getSuperchatReferenceFetchId(info: PaymentNotificationInfo): string | undefined {
  if (info.referencedEventId) return info.referencedEventId
  if (info.referencedCoordinate) {
    return generateBech32IdFromATag(['a', info.referencedCoordinate]) ?? undefined
  }
  return undefined
}

export function getSuperchatAmountSats(event: Event): number {
  if (event.kind === kinds.Zap) {
    return getZapInfoFromEvent(event)?.amount ?? 0
  }
  if (event.kind === ExtendedKind.PAYMENT_NOTIFICATION) {
    return getPaymentNotificationInfo(event)?.amountSats ?? 0
  }
  return 0
}

export function isSuperchatKind(kind: number): boolean {
  return kind === kinds.Zap || kind === ExtendedKind.PAYMENT_NOTIFICATION
}

/** Recipient pubkey for a kind 9735 or 9740 payment the user may attest to. */
export function getSuperchatPaymentRecipientPubkey(event: Event): string | null {
  if (event.kind === ExtendedKind.PAYMENT_NOTIFICATION) {
    return getPaymentNotificationInfo(event)?.recipientPubkey ?? null
  }
  if (event.kind === kinds.Zap || event.kind === ExtendedKind.ZAP_RECEIPT) {
    return getZapInfoFromEvent(event)?.recipientPubkey ?? null
  }
  return null
}

/** Target `k` tag value for a kind 9741 attestation pointing at this event. */
export function getSuperchatAttestationTargetKindValue(event: Event): string | null {
  if (event.kind === ExtendedKind.PAYMENT_NOTIFICATION) {
    return String(ExtendedKind.PAYMENT_NOTIFICATION)
  }
  if (event.kind === kinds.Zap || event.kind === ExtendedKind.ZAP_RECEIPT) {
    return String(ExtendedKind.ZAP_RECEIPT)
  }
  return null
}

export function isAttestableSuperchatPayment(event: Event): boolean {
  return getSuperchatAttestationTargetKindValue(event) != null
}

/** Incoming payment notification or zap receipt addressed to `userPubkey`. */
export function isIncomingPaymentNotificationOrZapReceipt(
  event: Event,
  userPubkey: string
): boolean {
  const recipient = getSuperchatPaymentRecipientPubkey(event)
  return recipient != null && hexPubkeysEqual(recipient, userPubkey)
}

export function isAttestedSuperchat(event: Event, attestedIds: Set<string>): boolean {
  if (!isSuperchatKind(event.kind)) return false
  return attestedIds.has(event.id.toLowerCase())
}

export function sortSuperchatsByAmountDesc(events: Event[]): Event[] {
  return [...events].sort((a, b) => {
    const sa = getSuperchatAmountSats(a)
    const sb = getSuperchatAmountSats(b)
    if (sb !== sa) return sb - sa
    return b.created_at - a.created_at
  })
}

export function partitionAttestedSuperchats(
  items: Event[],
  attestedIds: Set<string>,
  zapReplyThreshold: number
): { superchats: Event[]; rest: Event[] } {
  const superchats: Event[] = []
  const rest: Event[] = []

  for (const e of items) {
    if (e.kind === kinds.Zap) {
      if (
        isAttestedSuperchat(e, attestedIds) &&
        getZapInfoFromEvent(e) &&
        getSuperchatAmountSats(e) >= zapReplyThreshold
      ) {
        superchats.push(e)
      }
      continue
    }
    if (e.kind === ExtendedKind.PAYMENT_NOTIFICATION) {
      if (isAttestedSuperchat(e, attestedIds) && getPaymentNotificationInfo(e)) {
        superchats.push(e)
      }
      continue
    }
    rest.push(e)
  }

  return { superchats: sortSuperchatsByAmountDesc(superchats), rest }
}

export function replyFeedSuperchatsFirst(sortedNonSuperchatReplies: Event[], superchats: Event[]) {
  return [...superchats, ...sortedNonSuperchatReplies]
}

/** Kind 9740 on a profile wall: `p` is the profile owner and there is no note/thread reference. */
export function isProfileWallPaymentNotification(
  event: Event,
  profilePubkey: string,
  profileEventId?: string
): boolean {
  if (event.kind !== ExtendedKind.PAYMENT_NOTIFICATION) return false
  const info = getPaymentNotificationInfo(event)
  if (!info || info.recipientPubkey.toLowerCase() !== profilePubkey.toLowerCase()) return false

  if (info.referencedEventId) {
    const profileId = profileEventId?.trim().toLowerCase()
    if (profileId && info.referencedEventId === profileId) return true
    return false
  }

  if (info.referencedCoordinate) {
    const profileCoord = normalizeReplaceableCoordinateString(
      getReplaceableCoordinate(kinds.Metadata, profilePubkey, '')
    )
    if (normalizeReplaceableCoordinateString(info.referencedCoordinate) === profileCoord) {
      return true
    }
    return false
  }

  return true
}

export function filterAttestedProfileWallSuperchats(
  paymentNotifications: Event[],
  attestations: Event[],
  profilePubkey: string,
  profileEventId?: string
): Event[] {
  const attestedIds = buildAttestedPaymentIdSet(attestations, profilePubkey)
  return sortSuperchatsByAmountDesc(
    paymentNotifications.filter(
      (e) =>
        isProfileWallPaymentNotification(e, profilePubkey, profileEventId) &&
        isAttestedSuperchat(e, attestedIds)
    )
  )
}
