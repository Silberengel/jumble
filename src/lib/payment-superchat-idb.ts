import { ExtendedKind } from '@/constants'
import { normalizeReplaceableCoordinateString } from '@/lib/event'
import { getPaymentAttestationTargetId, getPaymentNotificationInfo } from '@/lib/superchat'
import type { Event } from 'nostr-tools'

export type PaymentNotificationIdbRow = {
  key: string
  value: Event
  addedAt: number
  recipientPubkey: string
  referencedEventId: string
  referencedCoordinate: string
}

export type PaymentAttestationIdbRow = {
  key: string
  value: Event
  addedAt: number
  authorPubkey: string
  targetEventId: string
}

function normalizeHexId(id: string | undefined): string {
  const t = id?.trim().toLowerCase() ?? ''
  return /^[0-9a-f]{64}$/.test(t) ? t : ''
}

function normalizePubkey(pk: string | undefined): string {
  const t = pk?.trim().toLowerCase() ?? ''
  return /^[0-9a-f]{64}$/.test(t) ? t : ''
}

export function paymentNotificationIdbRowFromEvent(ev: Event): PaymentNotificationIdbRow | null {
  if (ev.kind !== ExtendedKind.PAYMENT_NOTIFICATION) return null
  const info = getPaymentNotificationInfo(ev)
  if (!info?.recipientPubkey) return null
  const key = normalizeHexId(ev.id)
  if (!key) return null

  const clean = { ...ev } as Event
  delete (clean as { relayStatuses?: unknown }).relayStatuses
  clean.id = key

  return {
    key,
    value: clean,
    addedAt: Date.now(),
    recipientPubkey: normalizePubkey(info.recipientPubkey),
    referencedEventId: normalizeHexId(info.referencedEventId),
    referencedCoordinate: info.referencedCoordinate
      ? normalizeReplaceableCoordinateString(info.referencedCoordinate)
      : ''
  }
}

export function paymentAttestationIdbRowFromEvent(ev: Event): PaymentAttestationIdbRow | null {
  if (ev.kind !== ExtendedKind.PAYMENT_ATTESTATION) return null
  const targetEventId = getPaymentAttestationTargetId(ev)
  if (!targetEventId) return null
  const authorPubkey = normalizePubkey(ev.pubkey)
  if (!authorPubkey) return null
  const key = normalizeHexId(ev.id)
  if (!key) return null

  const clean = { ...ev } as Event
  delete (clean as { relayStatuses?: unknown }).relayStatuses
  clean.id = key

  return {
    key,
    value: clean,
    addedAt: Date.now(),
    authorPubkey,
    targetEventId: targetEventId.toLowerCase()
  }
}
