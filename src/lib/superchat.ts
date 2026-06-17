import { ExtendedKind } from '@/constants'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import {
  getReplaceableCoordinate,
  normalizeReplaceableCoordinateString
} from '@/lib/event'
import {
  getMoneroTipInfo,
  getMoneroTipSortAmount,
  isMoneroTipKind
} from '@/lib/monero-tip'
import { hexPubkeysEqual } from '@/lib/pubkey'
import { parsePaytoTagType } from '@/lib/payto'
import { generateBech32IdFromATag } from '@/lib/tag'
import { Event, kinds } from 'nostr-tools'

export const PAYMENT_ATTESTATION_TARGET_KINDS = new Set(['9735', '9740', '9736', '1814'])

/** Payment kinds shown in feeds only when attested (kind 9741); excludes lightning zap receipts. */
export const FEED_SUPERCHAT_KINDS: readonly number[] = [
  ExtendedKind.PAYMENT_NOTIFICATION,
  ExtendedKind.MONERO_TIP_DISCLOSURE,
  ExtendedKind.MONERO_TIP_RECEIPT
]

const FEED_SUPERCHAT_KIND_SET = new Set(FEED_SUPERCHAT_KINDS)

export function isFeedSuperchatKind(kind: number): boolean {
  return FEED_SUPERCHAT_KIND_SET.has(kind)
}

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

/** Kind 9741 from the payment recipient with a valid `e` (and `k` when present). */
export function isValidPaymentAttestation(attestation: Event, recipientPubkey: string): boolean {
  if (attestation.kind !== ExtendedKind.PAYMENT_ATTESTATION) return false
  if (!hexPubkeysEqual(attestation.pubkey, recipientPubkey)) return false
  if (!getPaymentAttestationTargetId(attestation)) return false
  const hasKTag = attestation.tags.some(([name]) => name === 'k' || name === 'K')
  if (hasKTag && !getPaymentAttestationTargetKind(attestation)) return false
  return true
}

/** Event ids (lowercase hex) the recipient has attested as received payment. */
export function buildAttestedPaymentIdSet(
  attestations: Event[],
  recipientPubkey: string
): Set<string> {
  const out = new Set<string>()
  for (const attestation of attestations) {
    if (!isValidPaymentAttestation(attestation, recipientPubkey)) continue
    const targetId = getPaymentAttestationTargetId(attestation)
    if (targetId) out.add(targetId)
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
  if (isMoneroTipKind(event.kind)) return 'monero'
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

/** Comparable sort weight for mixed lightning / monero superchats. */
export function getSuperchatSortAmount(event: Event): number {
  const sats = getSuperchatAmountSats(event)
  if (sats > 0) return sats
  return getMoneroTipSortAmount(event)
}

export function isSuperchatKind(kind: number): boolean {
  return (
    kind === kinds.Zap ||
    kind === ExtendedKind.ZAP_RECEIPT ||
    kind === ExtendedKind.PAYMENT_NOTIFICATION ||
    isMoneroTipKind(kind)
  )
}

/** Kinds that may be `#e` parents in the thread nested-reply relay pass (replies to zaps were missing). */
export function isNestedThreadReplyParentKind(kind: number): boolean {
  return (
    kind === kinds.ShortTextNote ||
    kind === ExtendedKind.COMMENT ||
    kind === ExtendedKind.VOICE_COMMENT ||
    isSuperchatKind(kind)
  )
}

/** Recipient pubkey for a kind 9735, 9740, 9736, or 1814 payment the user may attest to. */
export function getSuperchatPaymentRecipientPubkey(event: Event): string | null {
  if (event.kind === ExtendedKind.PAYMENT_NOTIFICATION) {
    return getPaymentNotificationInfo(event)?.recipientPubkey ?? null
  }
  if (isMoneroTipKind(event.kind)) {
    return getMoneroTipInfo(event)?.recipientPubkey ?? firstTagValue(event.tags, ['p']) ?? null
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
  return event.tags.some((t) => t[0] === 'p' && t[1] && hexPubkeysEqual(t[1], userPubkey))
}

/** Payment / tip kinds that may appear in the notifications feed (9734–9736, 1814, 9740). */
export function isIncomingNotificationsPaymentKind(kind: number): boolean {
  return (
    kind === ExtendedKind.ZAP_REQUEST ||
    kind === kinds.Zap ||
    kind === ExtendedKind.ZAP_RECEIPT ||
    kind === ExtendedKind.PAYMENT_NOTIFICATION ||
    isMoneroTipKind(kind)
  )
}

/**
 * Incoming payment or tip addressed to `userPubkey` — shown unattested in notifications only.
 * Covers kind 9734 (zap request), 9735, 9740, 9736, and 1814.
 */
export function isIncomingNotificationsPaymentEvent(
  event: Event,
  userPubkey: string,
  attestationRecipientPubkey?: string | null
): boolean {
  if (!isIncomingNotificationsPaymentKind(event.kind)) return false
  if (event.kind === ExtendedKind.ZAP_REQUEST) {
    return event.tags.some((t) => t[0] === 'p' && t[1] && hexPubkeysEqual(t[1], userPubkey))
  }
  if (isAttestableSuperchatPayment(event)) {
    return canUserAttestSuperchatPayment(event, userPubkey, attestationRecipientPubkey)
  }
  return false
}

/** @deprecated Use {@link isIncomingNotificationsPaymentEvent}. */
export function isIncomingPaymentNotificationOrZapReceipt(
  event: Event,
  userPubkey: string,
  attestationRecipientPubkey?: string | null
): boolean {
  return isIncomingNotificationsPaymentEvent(event, userPubkey, attestationRecipientPubkey)
}

/** Target `k` tag value for a kind 9741 attestation pointing at this event. */
export function getSuperchatAttestationTargetKindValue(event: Event): string | null {
  if (event.kind === ExtendedKind.PAYMENT_NOTIFICATION) {
    return String(ExtendedKind.PAYMENT_NOTIFICATION)
  }
  if (event.kind === ExtendedKind.MONERO_TIP_DISCLOSURE) {
    return String(ExtendedKind.MONERO_TIP_DISCLOSURE)
  }
  if (event.kind === ExtendedKind.MONERO_TIP_RECEIPT) {
    return String(ExtendedKind.MONERO_TIP_RECEIPT)
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
    const sa = getSuperchatSortAmount(a)
    const sb = getSuperchatSortAmount(b)
    if (sb !== sa) return sb - sa
    return b.created_at - a.created_at
  })
}

/**
 * Attested kind 9735 / 9740 events already in `repliesMap` that the thread BFS may not reach
 * (e.g. keyed only under a parent id, or hydrated after the walk).
 */
export function collectAttestedSuperchatsFromRepliesMap(
  repliesMap: ReadonlyMap<string, { events: Event[] }>,
  attestedIds: ReadonlySet<string>,
  alreadySeen: ReadonlySet<string>,
  includeEvent: (event: Event) => boolean
): Event[] {
  const out: Event[] = []
  const seen = new Set(alreadySeen)
  for (const { events } of repliesMap.values()) {
    for (const evt of events) {
      if (seen.has(evt.id)) continue
      if (!isSuperchatKind(evt.kind)) continue
      if (!isAttestedSuperchat(evt, attestedIds)) continue
      if (!includeEvent(evt)) continue
      seen.add(evt.id)
      out.push(evt)
    }
  }
  return out
}

export function partitionAttestedSuperchats(
  items: Event[],
  attestedIds: Set<string>
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
    if (isMoneroTipKind(e.kind)) {
      if (isAttestedSuperchat(e, attestedIds) && getMoneroTipInfo(e)) {
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

/** Target payment ids from any valid kind 9741 (feeds are not scoped to one recipient). */
export function buildGlobalAttestedSuperchatIdSet(attestations: Event[]): Set<string> {
  const out = new Set<string>()
  for (const attestation of attestations) {
    if (!isValidPaymentAttestation(attestation, attestation.pubkey)) continue
    const targetId = getPaymentAttestationTargetId(attestation)
    if (targetId) out.add(targetId.toLowerCase())
  }
  return out
}

/**
 * Feeds: kind 9735 / 9740 / 9736 / 1814 only when attested (9741).
 * Same attestation rule as threads and profile walls.
 *
 * When `incomingPaymentRecipientPubkey` is set (notifications feed), unattested kind
 * 9734 / 9735 / 9740 / 9736 / 1814 addressed to that pubkey are included so the recipient
 * can publish kind 9741 from the card (9734 is shown but not attestable).
 */
export function shouldIncludePaymentInFeed(
  event: Event,
  attestedIds: ReadonlySet<string>,
  incomingPaymentRecipientPubkey?: string | null
): boolean {
  if (!isSuperchatKind(event.kind)) return true
  if (isAttestedSuperchat(event, attestedIds)) return true
  if (
    incomingPaymentRecipientPubkey &&
    isIncomingNotificationsPaymentEvent(event, incomingPaymentRecipientPubkey)
  ) {
    return true
  }
  return false
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

/** Profile-wall payment (no note/thread `e`/`a` ref) — not a thread reply under any note. */
export function isProfileWallSuperchat(
  event: Event,
  profilePubkey: string,
  profileEventId?: string
): boolean {
  return (
    isProfileWallPaymentNotification(event, profilePubkey, profileEventId) ||
    isProfileWallZapReceipt(event, profilePubkey, profileEventId) ||
    isProfileWallMoneroTip(event, profilePubkey, profileEventId)
  )
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

/** Kind 9736 / 1814 profile tip on a wall: `p` is the profile owner and there is no note/thread reference. */
export function isProfileWallMoneroTip(event: Event, profilePubkey: string, profileEventId?: string): boolean {
  if (!isMoneroTipKind(event.kind)) return false
  const info = getMoneroTipInfo(event)
  if (!info?.recipientPubkey || !hexPubkeysEqual(info.recipientPubkey, profilePubkey)) {
    return false
  }
  const referencedEventId = event.tags.find((t) => t[0] === 'e' || t[0] === 'E')?.[1]?.trim().toLowerCase()
  return isProfileWallThreadReference(
    referencedEventId,
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
      if (isMoneroTipKind(e.kind)) {
        return (
          isProfileWallMoneroTip(e, profilePubkey, profileEventId) &&
          attestedIds.has(e.id.toLowerCase())
        )
      }
      return false
    })
  )
}
