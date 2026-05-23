import { ExtendedKind } from '@/constants'
import {
  findPaymentAttestationForTarget,
  getPaymentAttestationTargetId,
  getSuperchatPaymentRecipientPubkey
} from '@/lib/superchat'
import client from '@/services/client.service'
import { Event as NostrEvent } from 'nostr-tools'
import { useEffect, useState } from 'react'

export function usePaymentAttestationStatus(targetEvent: NostrEvent | undefined) {
  const [attested, setAttested] = useState(false)
  const [attestationEvent, setAttestationEvent] = useState<NostrEvent | null>(null)
  const [checking, setChecking] = useState(false)

  const recipientPubkey = targetEvent ? getSuperchatPaymentRecipientPubkey(targetEvent) : null
  const targetId = targetEvent?.id?.toLowerCase()

  useEffect(() => {
    setAttested(false)
    setAttestationEvent(null)
    if (!targetEvent?.id || !recipientPubkey) return

    let cancelled = false
    setChecking(true)

    void client
      .fetchEvents(
        [],
        {
          kinds: [ExtendedKind.PAYMENT_ATTESTATION],
          authors: [recipientPubkey],
          '#e': [targetEvent.id],
          limit: 5
        },
        { cache: true, eoseTimeout: 4000, globalTimeout: 10_000 }
      )
      .then((attestations) => {
        if (cancelled) return
        const match = findPaymentAttestationForTarget(attestations, targetEvent.id, recipientPubkey)
        setAttestationEvent(match ?? null)
        setAttested(Boolean(match))
      })
      .catch(() => {
        /* optional */
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })

    return () => {
      cancelled = true
    }
  }, [targetEvent, recipientPubkey, targetId])

  useEffect(() => {
    if (!targetEvent?.id || !recipientPubkey) return

    const handleAttestation = (data: globalThis.Event) => {
      const evt = (data as CustomEvent<NostrEvent>).detail
      if (!evt || evt.kind !== ExtendedKind.PAYMENT_ATTESTATION) return
      if (evt.pubkey.toLowerCase() !== recipientPubkey.toLowerCase()) return
      const attestedId = getPaymentAttestationTargetId(evt)
      if (attestedId?.toLowerCase() === targetEvent.id.toLowerCase()) {
        setAttested(true)
        setAttestationEvent(evt)
      }
    }

    client.addEventListener('newEvent', handleAttestation)
    return () => client.removeEventListener('newEvent', handleAttestation)
  }, [targetEvent?.id, recipientPubkey])

  return { attested, attestationEvent, checking, recipientPubkey }
}
