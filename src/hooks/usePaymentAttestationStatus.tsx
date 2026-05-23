import { ExtendedKind } from '@/constants'
import {
  getPaymentAttestationTargetId,
  getSuperchatPaymentRecipientPubkey
} from '@/lib/superchat'
import { hexPubkeysEqual } from '@/lib/pubkey'
import {
  hydrateAttestationsForAuthor,
  loadPaymentAttestationLocal,
  peekCachedPaymentAttestation,
  refreshPaymentAttestationFromRelays,
  rememberPaymentAttestationFromPublish
} from '@/lib/payment-attestation-cache'
import client from '@/services/client.service'
import { Event as NostrEvent } from 'nostr-tools'
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'

function attestationFilter(recipientPubkey: string, targetEventId: string) {
  return {
    kinds: [ExtendedKind.PAYMENT_ATTESTATION],
    authors: [recipientPubkey],
    '#e': [targetEventId.trim().toLowerCase()],
    limit: 5
  }
}

export function isPaymentAttestationForTarget(
  attestation: NostrEvent,
  targetEventId: string,
  recipientPubkey: string
): boolean {
  if (attestation.kind !== ExtendedKind.PAYMENT_ATTESTATION) return false
  if (!hexPubkeysEqual(attestation.pubkey, recipientPubkey)) return false
  const attestedId = getPaymentAttestationTargetId(attestation)
  return Boolean(attestedId && attestedId.toLowerCase() === targetEventId.trim().toLowerCase())
}

function readAttestedFromLocalSources(
  targetEventId: string | undefined,
  recipientPubkey: string | null
): { attested: boolean; attestationEvent: NostrEvent | null } {
  if (!targetEventId || !recipientPubkey) {
    return { attested: false, attestationEvent: null }
  }
  const hit = peekCachedPaymentAttestation(targetEventId, recipientPubkey)
  return {
    attested: Boolean(hit),
    attestationEvent: hit ?? null
  }
}

export function usePaymentAttestationStatus(
  targetEvent: NostrEvent | undefined,
  recipientPubkeyOverride?: string | null
) {
  const recipientPubkey = targetEvent
    ? recipientPubkeyOverride ?? getSuperchatPaymentRecipientPubkey(targetEvent)
    : null
  const targetId = targetEvent?.id?.toLowerCase()

  const filter = useMemo(
    () =>
      targetEvent?.id && recipientPubkey
        ? attestationFilter(recipientPubkey, targetEvent.id)
        : null,
    [targetEvent?.id, recipientPubkey]
  )

  const localSnapshot = useMemo(
    () => readAttestedFromLocalSources(targetEvent?.id, recipientPubkey),
    [targetEvent?.id, recipientPubkey, targetId]
  )

  const [attested, setAttested] = useState(localSnapshot.attested)
  const [attestationEvent, setAttestationEvent] = useState<NostrEvent | null>(
    localSnapshot.attestationEvent
  )
  const [checking, setChecking] = useState(false)

  const applyMatch = useCallback(
    (match: NostrEvent | undefined) => {
      if (!match || !targetEvent?.id || !recipientPubkey) return
      if (!isPaymentAttestationForTarget(match, targetEvent.id, recipientPubkey)) return
      setAttestationEvent(match)
      setAttested(true)
    },
    [recipientPubkey, targetEvent?.id]
  )

  const clearAttested = useCallback(() => {
    setAttestationEvent(null)
    setAttested(false)
  }, [])

  const markAttested = useCallback(
    (attestation: NostrEvent) => {
      if (!targetEvent?.id || !recipientPubkey) return
      if (!isPaymentAttestationForTarget(attestation, targetEvent.id, recipientPubkey)) return
      rememberPaymentAttestationFromPublish(attestation)
      applyMatch(attestation)
    },
    [applyMatch, recipientPubkey, targetEvent?.id]
  )

  useLayoutEffect(() => {
    const next = readAttestedFromLocalSources(targetEvent?.id, recipientPubkey)
    setAttestationEvent(next.attestationEvent)
    setAttested(next.attested)
  }, [recipientPubkey, targetEvent?.id, targetId])

  useEffect(() => {
    if (!recipientPubkey) return
    void hydrateAttestationsForAuthor(recipientPubkey)
  }, [recipientPubkey])

  useEffect(() => {
    if (!targetEvent?.id || !recipientPubkey || !filter) return

    let cancelled = false
    setChecking(true)

    void (async () => {
      try {
        const local = await loadPaymentAttestationLocal(targetEvent.id, recipientPubkey, filter)
        if (cancelled) return
        if (local) {
          applyMatch(local)
          return
        }
        const relay = await refreshPaymentAttestationFromRelays(
          targetEvent.id,
          recipientPubkey,
          filter
        )
        if (cancelled) return
        if (relay) {
          applyMatch(relay)
        } else {
          clearAttested()
        }
      } catch {
        /* optional */
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [applyMatch, clearAttested, filter, recipientPubkey, targetEvent?.id, targetId])

  useEffect(() => {
    if (!targetEvent?.id || !recipientPubkey) return

    const handleAttestation = (data: globalThis.Event) => {
      const attestation = (data as CustomEvent<NostrEvent>).detail
      if (attestation.kind !== ExtendedKind.PAYMENT_ATTESTATION) return
      markAttested(attestation)
    }

    client.addEventListener('newEvent', handleAttestation)
    return () => client.removeEventListener('newEvent', handleAttestation)
  }, [markAttested, targetEvent?.id, recipientPubkey])

  return { attested, attestationEvent, checking, recipientPubkey, markAttested }
}
