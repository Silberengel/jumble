import { ExtendedKind } from '@/constants'
import { findPaymentAttestationForTarget } from '@/lib/superchat'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import type { Event as NostrEvent, Filter } from 'nostr-tools'

const attestationByTargetKey = new Map<string, NostrEvent>()
const relayFetchByTargetKey = new Map<string, Promise<NostrEvent[]>>()

export function paymentAttestationCacheKey(targetEventId: string, recipientPubkey: string): string {
  return `${targetEventId.trim().toLowerCase()}:${recipientPubkey.trim().toLowerCase()}`
}

export function peekCachedPaymentAttestation(
  targetEventId: string,
  recipientPubkey: string
): NostrEvent | undefined {
  return attestationByTargetKey.get(paymentAttestationCacheKey(targetEventId, recipientPubkey))
}

export function rememberPaymentAttestation(
  targetEventId: string,
  recipientPubkey: string,
  attestation: NostrEvent
): void {
  attestationByTargetKey.set(
    paymentAttestationCacheKey(targetEventId, recipientPubkey),
    attestation
  )
}

export function resolvePaymentAttestationFromEvents(
  events: NostrEvent[],
  targetEventId: string,
  recipientPubkey: string
): NostrEvent | undefined {
  const match = findPaymentAttestationForTarget(events, targetEventId, recipientPubkey)
  if (match) {
    rememberPaymentAttestation(targetEventId, recipientPubkey, match)
  }
  return match
}

export async function loadPaymentAttestationLocal(
  targetEventId: string,
  recipientPubkey: string,
  filter: Filter
): Promise<NostrEvent | undefined> {
  const cached = peekCachedPaymentAttestation(targetEventId, recipientPubkey)
  if (cached) return cached

  const sessionHits = client.eventService.getSessionEventsMatchingFilters([filter], 5)
  const fromSession = resolvePaymentAttestationFromEvents(sessionHits, targetEventId, recipientPubkey)
  if (fromSession) return fromSession

  const idbAttestations = await indexedDb.getPaymentAttestationsForTargetEvent(targetEventId, 20)
  return resolvePaymentAttestationFromEvents(idbAttestations, targetEventId, recipientPubkey)
}

/** One coalesced relay refresh per payment target (shared by all visible superchat rows). */
export async function refreshPaymentAttestationFromRelays(
  targetEventId: string,
  recipientPubkey: string,
  filter: Filter
): Promise<NostrEvent | undefined> {
  const cached = peekCachedPaymentAttestation(targetEventId, recipientPubkey)
  if (cached) return cached

  const key = paymentAttestationCacheKey(targetEventId, recipientPubkey)
  let inflight = relayFetchByTargetKey.get(key)
  if (!inflight) {
    inflight = client
      .fetchEvents([], filter, {
        cache: true,
        eoseTimeout: 2500,
        globalTimeout: 6000
      })
      .finally(() => {
        if (relayFetchByTargetKey.get(key) === inflight) {
          relayFetchByTargetKey.delete(key)
        }
      })
    relayFetchByTargetKey.set(key, inflight)
  }

  const relayAttestations = await inflight
  return resolvePaymentAttestationFromEvents(relayAttestations, targetEventId, recipientPubkey)
}

export function rememberPaymentAttestationFromPublish(attestation: NostrEvent): void {
  if (attestation.kind !== ExtendedKind.PAYMENT_ATTESTATION) return
  const targetId = attestation.tags.find(([name]) => name === 'e' || name === 'E')?.[1]?.trim().toLowerCase()
  if (!targetId || !/^[0-9a-f]{64}$/.test(targetId)) return
  rememberPaymentAttestation(targetId, attestation.pubkey, attestation)
}
