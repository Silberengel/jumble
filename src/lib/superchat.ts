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
  const out = new Set<string>()
  for (const attestation of attestations) {
    if (!hexPubkeysEqual(attestation.pubkey, recipientPubkey)) continue
    const targetId = getPaymentAttestationTargetId(attestation)
    if (!targetId) continue
    out.add(targetId)
  }
  return out
}

/** Kind 9741 attestation from `recipientPubkey` for payment event `targetEventId`, if any. */
export function findPaymentAttestationForTarget(
  attestations: Event[],
  targetEventId: string,
  recipientPubkey: string
): Event | undefined {
  const target = targetEventId.trim().toLowerCase()
  for (const attestation of attestations) {
    if (!hexPubkeysEqual(attestation.pubkey, recipientPubkey)) continue
    const attestedId = getPaymentAttestationTargetId(attestation)
    if (!attestedId || attestedId.toLowerCase() !== target) continue
    return attestation
  }
  return undefined
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
  if (event.kind === kinds.Zap || event.kind === ExtendedKind.ZAP_RECEIPT) return 'lightning'
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
  if (event.kind === kinds.Zap || event.kind === ExtendedKind.ZAP_RECEIPT) {
    return getZapInfoFromEvent(event)?.amount ?? 0
  }
  if (event.kind === ExtendedKind.PAYMENT_NOTIFICATION) {
    return getPaymentNotificationInfo(event)?.amountSats ?? 0
  }
  return 0
}

export function isSuperchatKind(kind: number): boolean {
  return kind === kinds.Zap || kind === ExtendedKind.ZAP_RECEIPT || kind === ExtendedKind.PAYMENT_NOTIFICATION
}

/** Recipient pubkey for a kind 9735 or 9740 payment the user may attest to. */
export function getSuperchatPaymentRecipientPubkey(event: Event): string | null {
  if (event.kind === ExtendedKind.PAYMENT_NOTIFICATION) {
    return getPaymentNotificationInfo(event)?.recipientPubkey ?? null
  }
  if (event.kind === kinds.Zap || event.kind === ExtendedKind.ZAP_RECEIPT) {
    return getZapInfoFromEvent(event)?.recipientPubkey ?? firstTagValue(event.tags, ['p']) ?? null
  }
  return null
}

/** True when `userPubkey` may publish a kind 9741 attestation for this payment. */
export function canUserAttestSuperchatPayment(
  event: Event,
  userPubkey: string,
  attestationRecipientPubkey?: string | null
): boolean {
  if (!isAttestableSuperchatPayment(event)) return false
  const resolved = attestationRecipientPubkey ?? getSuperchatPaymentRecipientPubkey(event)
  if (resolved && hexPubkeysEqual(resolved, userPubkey)) return true
  const pTag = firstTagValue(event.tags, ['p'])
  return Boolean(pTag && hexPubkeysEqual(pTag, userPubkey))
}

/** Incoming payment notification or zap receipt addressed to `userPubkey`. */
export function isIncomingPaymentNotificationOrZapReceipt(
  event: Event,
  userPubkey: string,
  attestationRecipientPubkey?: string | null
): boolean {
  return canUserAttestSuperchatPayment(event, userPubkey, attestationRecipientPubkey)
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

export function isAttestedSuperchat(event: Event, attestedIds: ReadonlySet<string>): boolean {
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
  _zapReplyThreshold: number
): { superchats: Event[]; rest: Event[] } {
  const superchats: Event[] = []
  const rest: Event[] = []

  for (const e of items) {
    if (e.kind === kinds.Zap || e.kind === ExtendedKind.ZAP_RECEIPT) {
      if (isAttestedSuperchat(e, attestedIds) && getZapInfoFromEvent(e)) {
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

function isProfileWallThreadReference(
  referencedEventId: string | undefined,
  referencedCoordinate: string | undefined,
  profilePubkey: string,
  profileEventId?: string
): boolean {
  if (referencedEventId) {
    const profileId = profileEventId?.trim().toLowerCase()
    if (profileId && referencedEventId.toLowerCase() === profileId) return true
    return false
  }

  if (referencedCoordinate) {
    const profileCoord = normalizeReplaceableCoordinateString(
      getReplaceableCoordinate(kinds.Metadata, profilePubkey, '')
    )
    if (normalizeReplaceableCoordinateString(referencedCoordinate) === profileCoord) {
      return true
    }
    return false
  }

  return true
}

/** Kind 9740 on a profile wall: `p` is the profile owner and there is no note/thread reference. */
export function isProfileWallPaymentNotification(
  event: Event,
  profilePubkey: string,
  profileEventId?: string
): boolean {
  if (event.kind !== ExtendedKind.PAYMENT_NOTIFICATION) return false
  const info = getPaymentNotificationInfo(event)
  if (!info || !hexPubkeysEqual(info.recipientPubkey, profilePubkey)) return false

  return isProfileWallThreadReference(
    info.referencedEventId,
    info.referencedCoordinate,
    profilePubkey,
    profileEventId
  )
}

/** Kind 9735 profile zap on a wall: `p` is the profile owner and there is no note/thread reference. */
export function isProfileWallZapReceipt(
  event: Event,
  profilePubkey: string,
  profileEventId?: string
): boolean {
  if (event.kind !== kinds.Zap && event.kind !== ExtendedKind.ZAP_RECEIPT) return false
  const zapInfo = getZapInfoFromEvent(event)
  if (!zapInfo?.recipientPubkey || !hexPubkeysEqual(zapInfo.recipientPubkey, profilePubkey)) {
    return false
  }

  const referencedEventId = zapInfo.originalEventId?.trim().toLowerCase()
  return isProfileWallThreadReference(referencedEventId, undefined, profilePubkey, profileEventId)
}

export function filterAttestedProfileWallSuperchats(
  paymentEvents: Event[],
  attestations: Event[],
  profilePubkey: string,
  profileEventId?: string,
  attestedIdsOverride?: ReadonlySet<string>
): Event[] {
  const attestedIds = attestedIdsOverride ?? buildAttestedPaymentIdSet(attestations, profilePubkey)
  return sortSuperchatsByAmountDesc(
    paymentEvents.filter((e) => {
      if (e.kind === ExtendedKind.PAYMENT_NOTIFICATION) {
        return (
          isProfileWallPaymentNotification(e, profilePubkey, profileEventId) &&
          isAttestedSuperchat(e, attestedIds)
        )
      }
      if (e.kind === kinds.Zap || e.kind === ExtendedKind.ZAP_RECEIPT) {
        return (
          isProfileWallZapReceipt(e, profilePubkey, profileEventId) &&
          attestedIds.has(e.id.toLowerCase())
        )
      }
      return false
    })
  )
}
