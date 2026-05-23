import { ExtendedKind } from '@/constants'
import {
  findPaymentAttestationForTarget,
  getPaymentAttestationTargetId,
  getSuperchatPaymentRecipientPubkey
} from '@/lib/superchat'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
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

function resolveAttestationMatch(
  attestations: NostrEvent[],
  targetEventId: string,
  recipientPubkey: string
): NostrEvent | undefined {
  return findPaymentAttestationForTarget(attestations, targetEventId, recipientPubkey)
}

export function usePaymentAttestationStatus(targetEvent: NostrEvent | undefined) {
  const [attested, setAttested] = useState(false)
  const [attestationEvent, setAttestationEvent] = useState<NostrEvent | null>(null)
  const [checking, setChecking] = useState(false)

  const recipientPubkey = targetEvent ? getSuperchatPaymentRecipientPubkey(targetEvent) : null
  const targetId = targetEvent?.id?.toLowerCase()

  const filter = useMemo(
    () =>
      targetEvent?.id && recipientPubkey
        ? attestationFilter(recipientPubkey, targetEvent.id)
        : null,
    [targetEvent?.id, recipientPubkey]
  )

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
      applyMatch(attestation)
    },
    [applyMatch, recipientPubkey, targetEvent?.id]
  )

  useLayoutEffect(() => {
    setAttested(false)
    setAttestationEvent(null)
    if (!targetEvent?.id || !recipientPubkey || !filter) return

    const sessionHits = client.eventService.getSessionEventsMatchingFilters([filter], 5)
    applyMatch(resolveAttestationMatch(sessionHits, targetEvent.id, recipientPubkey))
  }, [applyMatch, filter, recipientPubkey, targetEvent?.id])

  useEffect(() => {
    if (!targetEvent?.id || !recipientPubkey || !filter) return

    let cancelled = false
    setChecking(true)

    void (async () => {
      try {
        const [idbAttestations, localFeedAttestations, relayAttestations] = await Promise.all([
          indexedDb.getPaymentAttestationsForTargetEvent(targetEvent.id, 20),
          client.getLocalFeedEvents([{ urls: [], filter }], { maxMatches: 5 }),
          client.fetchEvents([], filter, {
            cache: true,
            eoseTimeout: 4000,
            globalTimeout: 10_000
          })
        ])

        if (cancelled) return

        const merged = [...idbAttestations, ...localFeedAttestations, ...relayAttestations]
        applyMatch(resolveAttestationMatch(merged, targetEvent.id, recipientPubkey))
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
