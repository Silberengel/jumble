import { ExtendedKind } from '@/constants'
import {
  getPaymentAttestationTargetId,
  getSuperchatPaymentRecipientPubkey
} from '@/lib/superchat'
import {
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
    '#e': [targetEventId],
    limit: 5
  }
}

export function usePaymentAttestationStatus(targetEvent: NostrEvent | undefined) {
  const recipientPubkey = targetEvent ? getSuperchatPaymentRecipientPubkey(targetEvent) : null
  const targetId = targetEvent?.id?.toLowerCase()

  const filter = useMemo(
    () =>
      targetEvent?.id && recipientPubkey
        ? attestationFilter(recipientPubkey, targetEvent.id)
        : null,
    [targetEvent?.id, recipientPubkey]
  )

  const cached = useMemo(
    () =>
      targetEvent?.id && recipientPubkey
        ? peekCachedPaymentAttestation(targetEvent.id, recipientPubkey)
        : undefined,
    [targetEvent?.id, recipientPubkey, targetId]
  )

  const [attested, setAttested] = useState(Boolean(cached))
  const [attestationEvent, setAttestationEvent] = useState<NostrEvent | null>(cached ?? null)
  const [checking, setChecking] = useState(false)

  const applyMatch = useCallback((match: NostrEvent | undefined) => {
    if (!match) return
    setAttestationEvent(match)
    setAttested(true)
  }, [])

  const markAttested = useCallback(
    (attestation: NostrEvent) => {
      if (!targetEvent?.id || !recipientPubkey) return
      if (attestation.kind !== ExtendedKind.PAYMENT_ATTESTATION) return
      if (attestation.pubkey.toLowerCase() !== recipientPubkey.toLowerCase()) return
      const attestedId = getPaymentAttestationTargetId(attestation)
      if (attestedId?.toLowerCase() !== targetEvent.id.toLowerCase()) return
      rememberPaymentAttestationFromPublish(attestation)
      applyMatch(attestation)
    },
    [applyMatch, recipientPubkey, targetEvent?.id]
  )

  useLayoutEffect(() => {
    if (!targetEvent?.id || !recipientPubkey) {
      setAttested(false)
      setAttestationEvent(null)
      return
    }
    const hit = peekCachedPaymentAttestation(targetEvent.id, recipientPubkey)
    if (hit) {
      setAttestationEvent(hit)
      setAttested(true)
    }
  }, [recipientPubkey, targetEvent?.id])

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
        if (!cancelled) applyMatch(relay)
      } catch {
        /* optional */
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [applyMatch, filter, recipientPubkey, targetEvent?.id, targetId])

  useEffect(() => {
    if (!targetEvent?.id || !recipientPubkey) return

    const handleAttestation = (data: globalThis.Event) => {
      markAttested((data as CustomEvent<NostrEvent>).detail)
    }

    client.addEventListener('newEvent', handleAttestation)
    return () => client.removeEventListener('newEvent', handleAttestation)
  }, [markAttested, targetEvent?.id, recipientPubkey])

  return { attested, attestationEvent, checking, recipientPubkey, markAttested }
}
