import { ExtendedKind } from '@/constants'
import {
  getPaymentAttestationTargetId,
  getSuperchatPaymentRecipientPubkey
} from '@/lib/superchat'
import { hexPubkeysEqual } from '@/lib/pubkey'
import {
  hydrateAttestationsForAuthor,
  isLocallyMarkedAttested,
  loadPaymentAttestationLocal,
  markLocalAttestationTarget,
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

function readAttestedFromLocalSources(
  targetEventId: string | undefined,
  recipientPubkey: string | null
): { attested: boolean; attestationEvent: NostrEvent | null } {
  if (!targetEventId || !recipientPubkey) {
    return { attested: false, attestationEvent: null }
  }
  const hit = peekCachedPaymentAttestation(targetEventId, recipientPubkey)
  const locallyMarked = isLocallyMarkedAttested(recipientPubkey, targetEventId)
  return {
    attested: Boolean(hit) || locallyMarked,
    attestationEvent: hit ?? null
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

  const localSnapshot = useMemo(
    () => readAttestedFromLocalSources(targetEvent?.id, recipientPubkey),
    [targetEvent?.id, recipientPubkey, targetId]
  )

  const [attested, setAttested] = useState(localSnapshot.attested)
  const [attestationEvent, setAttestationEvent] = useState<NostrEvent | null>(
    localSnapshot.attestationEvent
  )
  const [checking, setChecking] = useState(false)

  const applyMatch = useCallback((match: NostrEvent | undefined) => {
    if (!match) return
    setAttestationEvent(match)
    setAttested(true)
  }, [])

  const markAttested = useCallback(
    (attestation: NostrEvent) => {
      if (!targetEvent?.id || !recipientPubkey) return
      markLocalAttestationTarget(recipientPubkey, targetEvent.id)
      if (attestation.kind !== ExtendedKind.PAYMENT_ATTESTATION) {
        setAttested(true)
        return
      }
      if (!hexPubkeysEqual(attestation.pubkey, recipientPubkey)) return
      const attestedId = getPaymentAttestationTargetId(attestation)
      if (!attestedId || attestedId.toLowerCase() !== targetEvent.id.toLowerCase()) return
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

    if (isLocallyMarkedAttested(recipientPubkey, targetEvent.id)) {
      setAttested(true)
    }

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
        if (isLocallyMarkedAttested(recipientPubkey, targetEvent.id)) {
          setAttested(true)
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
